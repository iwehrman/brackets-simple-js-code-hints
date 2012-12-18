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
/*global define, brackets, CodeMirror */

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
    
    /**
     * @constructor
     */
    function JSHints() {
    }

    JSHints.prototype.hasHints = function (ed, key) {
        console.log("JSHint.hasHints");
        var token;
        editor = ed;

        if (_documentIsJavaScript()) {
            token = editor._codeMirror.getTokenAt(editor.getCursorPos());
            
            if ((!key) || (/[a-z_.\$\(\,]/i.test(key))) {
                // don't autocomplete within strings or comments, etc.
                return (!(token.className === "string" ||
                    token.className === "comment" ||
                    token.className === "number"));
            }
        }
        return false;
    };

    JSHints.prototype.getHints = function (key) {
        var response = null,
            cursor = editor.getCursorPos(),
            hints,
            hintList,
            token,
            query;

        console.log("JSHint.getHints");

        if (_documentIsJavaScript()) {
            
            // FIXME needs special cases for earlier punctuation like ','
            if (key === " " || key === ";" || key === ")" || key === "}") {
                return response;
            }

            hints = CodeMirror.javascriptHint(editor._codeMirror);
            if (hints && hints.list && hints.list.length > 0) {
                hintList = hints.list;

                token = editor._codeMirror.getTokenAt(cursor);
                
                if (token.className === "string" ||
                        token.className === "comment" ||
                        token.className === "number") {
                    return response;
                }
                    
                if (token !== null && token.string !== null) {
                    console.log("token: '" + token.string + "'");
                    query = token.string;
                    
                    // remove current possibly incomplete token
                    hintList.splice(hintList.indexOf(token.string), 1);
                } else {
                    query = "";
                }

                response = {
                    hints: hintList,
                    match: query,
                    selectInitial: !((token.string === "(") || (token.string === ","))
                };
            }
        }

        return response;
    };

    /**
     * Enters the code completion text into the editor
     * @param {string} completion - text to insert into current code editor
     * @param {Editor} editor
     * @param {Cursor} current cursor location
     */
    JSHints.prototype.insertHint = function (completion) {
        var cm = editor._codeMirror,
            cursor = editor.getCursorPos(),
            token,
            offset = 0;

        console.log("JSHint.insertHint");

        // in case we changed documents, don't change anything
        if (_documentIsJavaScript(editor.document)) {
            token = cm.getTokenAt(cursor);
            if (token) {

                // punctuation tokens should never be replaced
                if (token.string.lastIndexOf(".") === token.string.length - 1 ||
                        token.string.lastIndexOf(";") === token.string.length - 1 ||
                        token.string.lastIndexOf(":") === token.string.length - 1 ||
                        token.string.lastIndexOf("(") === token.string.length - 1 ||
                        token.string.lastIndexOf(")") === token.string.length - 1 ||
                        token.string.lastIndexOf("{") === token.string.length - 1 ||
                        token.string.lastIndexOf("}") === token.string.length - 1 ||
                        token.string.lastIndexOf("[") === token.string.length - 1 ||
                        token.string.lastIndexOf("]") === token.string.length - 1 ||
                        token.string.lastIndexOf(",") === token.string.length - 1) {
                    offset = token.string.length;
                }

                cm.replaceRange(completion,
                                {line: cursor.line, ch: token.start + offset},
                                {line: cursor.line, ch: token.end + offset});
            }
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
