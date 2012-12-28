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
/*global define, brackets, CodeMirror, $ */

define(function (require, exports, module) {
    "use strict";

    var CodeHintManager         = brackets.getModule("editor/CodeHintManager"),
        EditorManager           = brackets.getModule("editor/EditorManager"),
        EditorUtils             = brackets.getModule("editor/EditorUtils"),
        AppInit                 = brackets.getModule("utils/AppInit");

    // hinting is provided by CodeMirror
    require("thirdparty/CodeMirror2/lib/util/javascript-hint.js");

    var editor = null;

    function _documentIsJavaScript() {
        var doc;
        if (editor) {
            doc = editor.document;
            return doc &&
                EditorUtils.getModeFromFileExtension(doc.file.fullPath) === "javascript";
        }
    }

    function _maybeIdentifier(key) {
        return (/[0-9a-z_.\$]/i).test(key);
    }
    
    function _okTokenClass(token) {
        switch (token.className) {
        case "string":
        case "comment":
        case "number":
        case "regexp":
            return false;
        default:
            return true;
        }
    }
    
    /**
     * @constructor
     */
    function JSHints() {
    }

    JSHints.prototype.hasHints = function (ed, key) {
        console.log("JSHint.hasHints: " +
                    (key !== null ? ("'" + key + "'") : key));
        var token;
        editor = ed;

        if (_documentIsJavaScript()) {
            token = editor._codeMirror.getTokenAt(editor.getCursorPos());
            
            if ((key === null) || _maybeIdentifier(key)) {
                // don't autocomplete within strings or comments, etc.
                return _okTokenClass(token);
            }
        }
        return false;
    };
    

    JSHints.prototype.getHints = function (key) {
        var cursor = editor.getCursorPos(),
            hints,
            hintList,
            token,
            query,
            index;
        
        console.log("JSHint.getHints: " +
                    (key !== null ? ("'" + key + "'") : key));

        if (!_maybeIdentifier(key)) {
            return null;
        }
        
        hints = CodeMirror.javascriptHint(editor._codeMirror);
        if (hints && hints.list && hints.list.length > 0) {
            hintList = hints.list;
            token = editor._codeMirror.getTokenAt(cursor);
            
            if (token) {
                console.log("token: '" + token.string + "'");
                if (!(_okTokenClass(token))) {
                    return null;
                }
                
                if (token.string !== null) {
                    query = token.string;
                    
                    // remove current possibly incomplete token
                    index = hintList.indexOf(token.string);
                    if (index >= 0) {
                        hintList.splice(index, 1);
                    }
                } else {
                    query = "";
                }
    
                hintList = hintList.map(function (hint) {
                    var index = hint.indexOf(query),
                        $hintObj = $('<span>');
                    
                    if (index >= 0) {
                        $hintObj.append(hint.slice(0, index))
                            .append($('<span>')
                                    .append(hint.slice(index, index + query.length))
                                    .css('font-weight', 'bold'))
                            .append(hint.slice(index + query.length));
                    } else {
                        $hintObj.text(hint);
                    }
                    $hintObj.data('hint', hint);
                    return $hintObj;
                });
                
                return {
                    hints: hintList,
                    match: null,
                    selectInitial: true
                };
            }
        }

        return null;
    };

    /**
     * Enters the code completion text into the editor
     * 
     * @param {string} hint - text to insert into current code editor
     */
    JSHints.prototype.insertHint = function (hint) {
        var completion = hint.data('hint'),
            cm = editor._codeMirror,
            cursor = editor.getCursorPos(),
            token,
            offset = 0;

        console.log("JSHint.insertHint: '" + completion + "'");

        token = cm.getTokenAt(cursor);
        if (token) {

            if (token.string.lastIndexOf(".") === token.string.length - 1) {
                offset = token.string.length;
            }

            cm.replaceRange(completion,
                            {line: cursor.line, ch: token.start + offset},
                            {line: cursor.line, ch: token.end + offset});
        }

        return false;
    };

    // load the extension
    AppInit.appReady(function () {
        var jsHints = new JSHints();
        CodeHintManager.registerHintProvider(jsHints, ["javascript"], 0);
        console.log("JSHints");

        // for unit testing
        exports.jsHintProvider = jsHints;
    });
});
