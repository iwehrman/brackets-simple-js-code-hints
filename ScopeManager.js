/*
 * Copyright (c) 2012 Adobe Systems Incorporated. All rights reserved.
 *  
 * Permission is hereby granted, free of charge, to any person obtaining a
 * copy of this software and associated documentation files (the "Software"), 
 * to deal in the Software without restriction, including without limitation 
 * the rights to use, copy, modify, merge, publish, distribute, sublicense, 
 * and/or sell copies of the Software, and to permit persons to whom the 
 * Software is furnished to do so, subject to the following conditions:
 *  
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *  
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, 
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER 
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING 
 * FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER 
 * DEALINGS IN THE SOFTWARE.
 * 
 */

/*jslint vars: true, plusplus: true, devel: true, nomen: true, indent: 4, maxerr: 50 */
/*global define, brackets, $, Worker */

define(function (require, exports, module) {
    "use strict";

    var DocumentManager         = brackets.getModule("document/DocumentManager"),
        EditorUtils             = brackets.getModule("editor/EditorUtils"),
        FileUtils               = brackets.getModule("file/FileUtils"),
        NativeFileSystem        = brackets.getModule("file/NativeFileSystem").NativeFileSystem,
        ProjectManager          = brackets.getModule("project/ProjectManager"),
        HintUtils               = require("HintUtils"),
        Scope                   = require("Scope").Scope;

    var pendingRequest      = null,  // information about a deferred scope request
        allIdentifiers      = {},    // dir -> file -> list of identifiers for the given file
        allGlobals          = {},    // dir -> file -> list of globals for the given file
        allProperties       = {},    // dir -> file -> list of properties for the given file
        allLiterals         = {},    // dir -> file -> list of literals for the given file
        allAssociations     = {},    // dir -> file -> object-property associations for the given file
        outerScope          = {},    // dir -> file -> outer-most scope for the given file
        outerScopeDirty     = {},    // dir -> file -> has the given file changed since the last outer scope request? 
        innerScopeDirty     = {},    // dir -> file -> has the outer scope for the given file changed since the last inner scope request?
        outerWorkerActive   = {},    // dir -> file -> is the outer worker active for the given path? 
        outerScopeWorker    = (function () {
            var path = module.uri.substring(0, module.uri.lastIndexOf("/") + 1);
            return new Worker(path + "parser-worker.js");
        }());

    /**
     * Request a new outer scope object from the parser worker, if necessary
     */
    function refreshOuterScope(dir, file, text) {

        /* 
         * Initialize state maps for a given directory name and file name
         */
        function initializeFile(dir, file) {
            // initialize outerScope, etc. at dir
            if (!outerScope.hasOwnProperty(dir)) {
                outerScope[dir] = {};
            }
            if (!innerScopeDirty.hasOwnProperty(dir)) {
                innerScopeDirty[dir] = {};
            }
            if (!outerScopeDirty.hasOwnProperty(dir)) {
                outerScopeDirty[dir] = {};
            }
            if (!outerWorkerActive.hasOwnProperty(dir)) {
                outerWorkerActive[dir] = {};
            }
            if (!allGlobals.hasOwnProperty(dir)) {
                allGlobals[dir] = {};
            }
            if (!allIdentifiers.hasOwnProperty(dir)) {
                allIdentifiers[dir] = {};
            }
            if (!allProperties.hasOwnProperty(dir)) {
                allProperties[dir] = {};
            }
            if (!allLiterals.hasOwnProperty(dir)) {
                allLiterals[dir] = {};
            }
            if (!allAssociations.hasOwnProperty(dir)) {
                allAssociations[dir] = {};
            }

            // initialize outerScope[dir], etc. at file
            if (!outerScope[dir].hasOwnProperty(file)) {
                outerScope[dir][file] = null;
            }
            if (!innerScopeDirty[dir].hasOwnProperty(file)) {
                innerScopeDirty[dir][file] = true;
            }
            if (!outerScopeDirty[dir].hasOwnProperty(file)) {
                outerScopeDirty[dir][file] = true;
            }
            if (!outerWorkerActive[dir].hasOwnProperty(file)) {
                outerWorkerActive[dir][file] = false;
            }
        }

        initializeFile(dir, file);
       
        // if there is not yet an outer scope or if the file has changed then
        // we might need to update the outer scope
        if (outerScope[dir][file] === null || outerScopeDirty[dir][file]) {
            if (!outerWorkerActive[dir][file]) {
                // FIXME: we may want to debounce this call
                var path    = dir + file,
                    entry   = new NativeFileSystem.FileEntry(path);
                
                // the outer scope worker is about to be active
                outerWorkerActive[dir][file] = true;
                
                // the file will be clean since the last outer scope request
                outerScopeDirty[dir][file] = false;
                
                // send text to the parser worker
                outerScopeWorker.postMessage({
                    type        : HintUtils.SCOPE_MSG_TYPE,
                    dir         : dir,
                    file        : file,
                    text        : text,
                    force       : !outerScope[dir][file]
                });
            }
        }
    }

    /**
     * Recompute the inner scope for a given cursor position, if necessary
     */
    function refreshInnerScope(dir, file, offset) {

        /*
         * Filter a list of tokens using a given scope object
         */
        function filterByScope(tokens, scope) {
            return tokens.filter(function (id) {
                var level = scope.contains(id.value);
                return (level >= 0);
            });
        }
        
        /*
         * Combine a set of sets using the add operation
         */
        function merge(sets, add) {
            var combinedSet = {},
                file;

            for (file in sets) {
                if (sets.hasOwnProperty(file)) {
                    add(combinedSet, sets[file]);
                }
            }

            return combinedSet;
        }

        /*
         * Combine properties from files in the current file's directory into
         * one sorted list. 
         */
        function mergeProperties(dir) {
            
            function addPropObjs(obj1, obj2) {
                function addToObj(obj, token) {
                    if (!Object.prototype.hasOwnProperty.call(obj, token.value)) {
                        obj[token.value] = token;
                    }
                }

                obj2.forEach(function (token) { addToObj(obj1, token); });
            }
            
            var propobj = merge(allProperties[dir], addPropObjs),
                proplist = [],
                propname;
            
            for (propname in propobj) {
                if (Object.prototype.hasOwnProperty.call(propobj, propname)) {
                    proplist.push(propobj[propname]);
                }
            }

            return proplist;
        }
        
        /* 
         * Combine association objects from multiple files
         */
        function mergeAssociations(dir, file) {
            function addAssocSets(list1, list2) {
                var name;

                function addAssocObjs(assoc1, assoc2) {
                    var name;

                    for (name in assoc2) {
                        if (Object.prototype.hasOwnProperty.call(assoc2, name)) {
                            if (Object.prototype.hasOwnProperty.call(assoc1, name)) {
                                assoc1[name] = assoc1[name] + assoc2[name];
                            } else {
                                assoc1[name] = assoc2[name];
                            }
                        }
                    }
                }

                for (name in list2) {
                    if (Object.prototype.hasOwnProperty.call(list2, name)) {
                        if (Object.prototype.hasOwnProperty.call(list1, name)) {
                            addAssocObjs(list1[name], list2[name]);
                        } else {
                            list1[name] = list2[name];
                        }
                    }
                }
            }
            
            return merge(allAssociations[dir], addAssocSets);
        }
        
        // If there is no outer scope, the inner scope request is deferred. 
        if (!outerScope[dir] || !outerScope[dir][file]) {
            if (pendingRequest && pendingRequest.deferred.state() === "pending") {
                pendingRequest.deferred.reject();
            }

            pendingRequest = {
                dir         : dir,
                file        : file,
                offset      : offset,
                deferred    : $.Deferred()
            };
            
            // Request the outer scope from the parser worker.
            DocumentManager.getDocumentForPath(dir + file).done(function (document) {
                refreshOuterScope(dir, file, document.getText());
            });
            return { deferred: pendingRequest.deferred };
        } else {
            // The inner scope will be clean after this
            innerScopeDirty[dir][file] = false;
            
            // Try to find an inner scope from the current outer scope
            var innerScope = outerScope[dir][file].findChild(offset);
            
            if (!innerScope) {
                // we may have failed to find a child scope because a 
                // character was added to the end of the file, outside of
                // the (now out-of-date and currently-being-updated) 
                // outer scope. Hence, if offset is greater than the range
                // of the outerScope, we manually set innerScope to the
                // outerScope
                innerScope = outerScope[dir][file];
            }
            
            // FIXME: This could be more efficient if instead of filtering
            // the entire list of identifiers we just used the identifiers
            // in the scope of innerScope, but that list doesn't have the
            // accumulated position information.
            var scopedIdentifiers = filterByScope(allIdentifiers[dir][file], innerScope),
                scopedProperties = mergeProperties(dir, file),
                scopedAssociations = mergeAssociations(dir, file);
            
            return {
                scope: innerScope,
                identifiers: scopedIdentifiers,
                globals: allGlobals[dir][file],
                properties: scopedProperties,
                literals: allLiterals[dir][file],
                associations: scopedAssociations
            };
        }
    }
    
    /**
     * Get a new inner scope, if possible. If there is no outer scope for the
     * given file, a deferred scope will be returned instead.
     */
    function getScope(document, offset) {
        var path    = document.file.fullPath,
            split   = HintUtils.splitPath(path),
            dir     = split.dir,
            file    = split.file;
        
        return refreshInnerScope(dir, file, offset);
    }

    /**
     * Is the inner scope dirty? (It is if the outer scope has changed since
     * the last inner scope request)
     */
    function isScopeDirty(document, offset) {
        var path    = document.file.fullPath,
            split   = HintUtils.splitPath(path),
            dir     = split.dir,
            file    = split.file;
        
        return innerScopeDirty[dir][file];
    }

    /**
     * Mark a file as dirty, which causes an outer scope request to trigger
     * a reparse request. 
     */
    function markFileDirty(dir, file) {
        if (!outerScopeDirty.hasOwnProperty(dir)) {
            outerScopeDirty[dir] = {};
        }
        outerScopeDirty[dir][file] = true;
    }

    /**
     * Refresh the outer scopes of the given file as well as of the other files
     * in the given directory.
     */
    function handleEditorChange(document) {
        var path        = document.file.fullPath,
            split       = HintUtils.splitPath(path),
            dir         = split.dir,
            file        = split.file,
            dirEntry    = new NativeFileSystem.DirectoryEntry(dir),
            reader      = dirEntry.createReader();
        
        markFileDirty(dir, file);
        
        reader.readEntries(function (entries) {
            entries.forEach(function (entry) {
                if (entry.isFile) {
                    var path    = entry.fullPath,
                        split   = HintUtils.splitPath(path),
                        dir     = split.dir,
                        file    = split.file;
                    
                    if (file.indexOf(".") > 1) { // ignore /.dotfiles
                        var mode = EditorUtils.getModeFromFileExtension(entry.fullPath);
                        if (mode === HintUtils.MODE_NAME) {
                            DocumentManager.getDocumentForPath(path).done(function (document) {
                                refreshOuterScope(dir, file, document.getText());
                            });
                        }
                    }
                }
            });
        }, function (err) {
            console.log("Unable to refresh directory: " + err);
            refreshOuterScope(dir, file, document.getText());
        });
    }

    /*
     * When a file changes, mark it as being dirty and refresh its outer scope.
     */
    function handleFileChange(document) {
        var path    = document.file.fullPath,
            split   = HintUtils.splitPath(path),
            dir     = split.dir,
            file    = split.file;
        
        markFileDirty(dir, file);
        refreshOuterScope(dir, file, document.getText());
    }

    /*
     * Receive an outer scope object from the parser worker
     */
    function handleOuterScope(response) {
        
        var dir     = response.dir,
            file    = response.file,
            path    = dir + file,
            scopeInfo;

        if (outerWorkerActive[dir][file]) {
            outerWorkerActive[dir][file] = false;
            if (response.success) {
                outerScope[dir][file] = new Scope(response.scope);
                
                // The outer scope should cover the entire file
                outerScope[dir][file].range.start = 0;
                outerScope[dir][file].range.end = response.length;
                
                allGlobals[dir][file] = response.globals;
                allIdentifiers[dir][file] = response.identifiers;
                allProperties[dir][file] = response.properties;
                allLiterals[dir][file] = response.literals;
                allAssociations[dir][file] = response.associations;
                innerScopeDirty[dir][file] = true;

                if (outerScopeDirty[dir][file]) {
                    DocumentManager.getDocumentForPath(path).done(function (document) {
                        refreshOuterScope(dir, file, document.getText());
                    });
                }

                if (pendingRequest !== null && pendingRequest.dir === dir &&
                        pendingRequest.file === file) {
                    if (pendingRequest.deferred.state() === "pending") {
                        scopeInfo = refreshInnerScope(dir, file, pendingRequest.offset);
                        if (scopeInfo && !scopeInfo.deferred) {
                            pendingRequest.deferred.resolveWith(null, [scopeInfo]);
                            pendingRequest = null;
                        }
                    }
                }
            }
        } else {
            console.log("Expired scope request: " + path);
        }
    }

    outerScopeWorker.addEventListener("message", function (e) {
        var response = e.data,
            type = response.type;

        if (type === HintUtils.SCOPE_MSG_TYPE) {
            handleOuterScope(response);
        } else {
            console.log("Worker: " + (response.log || response));
        }
    });
    
    // reset state on project change
    $(ProjectManager)
        .on(HintUtils.eventName("beforeProjectClose"),
            function (event, projectRoot) {
                allGlobals          = {};
                allIdentifiers      = {};
                allProperties       = {};
                allLiterals         = {};
                allAssociations     = {};
                outerScope          = {};
                outerScopeDirty     = {};
                innerScopeDirty     = {};
                outerWorkerActive   = {};
            });
    
    // relocate scope information on file rename
    $(DocumentManager)
        .on(HintUtils.eventName("fileNameChange"),
            function (event, oldname, newname) {
                var oldsplit    = HintUtils.splitPath(oldname),
                    olddir      = oldsplit.dir,
                    oldfile     = oldsplit.file,
                    newsplit    = HintUtils.splitPath(newname),
                    newdir      = newsplit.dir,
                    newfile     = newsplit.file;
        
                /*
                 * Move property obj[olddir][oldfile] to obj[newdir][newfile]
                 */
                function moveProp(obj) {
                    if (obj.hasOwnProperty(olddir) && obj[olddir].hasOwnProperty(oldfile)) {
                        if (!obj.hasOwnProperty(newdir)) {
                            obj[newdir] = {};
                        }
                        obj[newdir][newfile] = obj[olddir][oldfile];
                        obj[olddir][oldfile] = null;
                    }
                }
                
                moveProp(outerScope);
                moveProp(outerScopeDirty);
                moveProp(innerScopeDirty);
                moveProp(outerWorkerActive);
                moveProp(allGlobals);
                moveProp(allIdentifiers);
                moveProp(allProperties);
                moveProp(allLiterals);
                moveProp(allAssociations);
            });
    
    exports.handleEditorChange = handleEditorChange;
    exports.handleFileChange = handleFileChange;
    exports.getScope = getScope;
    exports.isScopeDirty = isScopeDirty;

});
