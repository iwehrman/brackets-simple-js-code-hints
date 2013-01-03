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
/*global self, importScripts, esprima */

(function () {
    'use strict';

    importScripts('esprima/esprima.js', 'scope.js');
    
    var _path   = null,
        _ast    = null,
        _tokens = null,
        _scope  = null;

    function _parse(text) {
        var result = esprima.parse(text, {
            loc         : true,
            range       : true,
            tokens      : true,
            tolerant    : true
        });

        return result;
    }
    
    function _filterByScope(offset) {
        var cursorScope = _scope.findChild(offset),
            token,
            uniqueTokens,
            matchingTokens = [];
        
        if (cursorScope === null) {
            // just use the global scope if the cursor is not in range
            cursorScope = _scope;
            console.log("Global scope");
        }

        uniqueTokens = _tokens.reduce(function (prev, curr) {
            if (cursorScope.contains(curr.value) >= 0) {
                prev[curr.value] = curr;
            }
            return prev;
        }, {});
        
        for (token in uniqueTokens) {
            if (Object.prototype.hasOwnProperty.call(uniqueTokens, token)) {
                matchingTokens.push(token);
            }
        }
        // TODO: sort tokens by scope + distance from offset
        
        return matchingTokens;
    }
    
    self.addEventListener("message", function (e) {
        var type = e.data.type;
        
        if (type === "parse") {
            
            var text    = e.data.text,
                path    = e.data.path,
                offset  = e.data.offset,
                result;
            
            result = {
                type        : type,
                success     : false,
                path        : path
            };
            
            try {
                _ast = _parse(e.data.text);
                _tokens = _ast.tokens;
                _scope = new self.Scope(_ast);
                _path = path;
                result.parsed = true;
                
                self.postMessage({log: "Parsed: " + _ast.tokens.length});
                if (_ast.errors.length > 0) {
                    self.postMessage({log: "Parse errors: " + JSON.stringify(_ast.errors)});
                }
            } catch (err) {
                result.parsed = false;
                
                self.postMessage({log: "Esprima error: " + err});
            }
            
            if (path === _path && _ast !== null) {
                // either parsing succeeded, or it failed 
                _scope = new self.Scope(_ast);
                result.success = true;
                result.tokens = _filterByScope(offset);
            } else {
                result.success = false;
            }
            
            self.postMessage(result);
        } else {
            self.postMessage({
                log : "Unknown message: " + JSON.stringify(e.data)
            });
        }
    });
}());