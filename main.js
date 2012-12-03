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

    function _documentIsJavaScript(doc) {
        return doc && EditorUtils.getModeFromFileExtension(doc.file.fullPath) === "javascript";
    }

    /**
     * @constructor
     */
    function JSHints() {
    }

    /**
     * Filters the source list by query and returns the result
     * @param {Object.<queryStr: string, ...} query -- a query object with a required property queryStr 
     *     that will be used to filter out code hints
     * @return {Array.<string>}
     */
    JSHints.prototype.search = function (query) {
        return query.hintList;
    };

    /**
     * Figures out the text to use for the hint list query based on the text
     * around the cursor
     * Query is the text from the start of a tag to the current cursor position
     * @param {Editor} editor
     * @param {Cursor} current cursor location
     * @return {Object.<queryStr: string, ...} search query results will be filtered by.
     *      Return empty queryStr string to indicate code hinting should not filter and show all results.
     *      Return null in queryStr to indicate NO hints can be provided.
     */
    JSHints.prototype.getQueryInfo = function (editor, cursor) {
        var queryInfo = {queryStr: null}; // by default, don't handle
        var token, hints, hintList, query, index;

        if (_documentIsJavaScript(editor.document)) {
            hints = CodeMirror.javascriptHint(editor._codeMirror);
            if (hints && hints.list) {
                hintList = hints.list;

                // remove current possibly incomplete token
                token = editor._codeMirror.getTokenAt(cursor);
                if (token !== null && token.string !== null) {
                    query = token.string;
                } else {
                    query = "";
                }
                index = hintList.indexOf(query);
                if (index >= 0) {
                    hintList.splice(index, 1);
                }

                queryInfo.hintList = hintList;
                queryInfo.queryStr = query;
            }
        }

        return queryInfo;
    };

    /**
     * Enters the code completion text into the editor
     * @param {string} completion - text to insert into current code editor
     * @param {Editor} editor
     * @param {Cursor} current cursor location
     */
    JSHints.prototype.handleSelect = function (completion, editor, cursor) {
        var token;
        var cm = editor._codeMirror;

        // on the off-chance we changed documents, don't change anything
        if (_documentIsJavaScript(editor.document)) {
            token = cm.getTokenAt(cursor);
            if (token) {

                // if the token is a period, append the completion;
                // otherwise replace the existing token 
                var offset = 0;
                if (token.string === ".") {
                    offset = 1;
                }

                cm.replaceRange(completion,
                                {line: cursor.line, ch: token.start + offset},
                                {line: cursor.line, ch: token.end + offset});
            }
        }
        return true;
    };

    /**
     * Check whether to show hints on a specific key.
     * @param {string} key -- the character for the key user just presses.
     * @return {boolean} return a boolean to indicate whether hinting should be triggered.
     */
    JSHints.prototype.shouldShowHintsOnKey = function (key) {
        var editor = EditorManager.getFocusedEditor(), token;
        if (editor && _documentIsJavaScript(editor.document) &&
                /[a-z_.\$]/.test(key)) {

            // don't autocomplete within strings or comments, etc.
            token = editor._codeMirror.getTokenAt(editor.getCursorPos());
            return (!(token.className === "string" ||
                token.className === "comment"));
        }
        return false;
    };

    // load the extension
    AppInit.appReady(function () {
        var jsHints = new JSHints();
        CodeHintManager.registerHintProvider(jsHints);
    });
});
