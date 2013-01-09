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

function define(f) {
    'use strict';
    f(null, self, null);
}

(function () {
    'use strict';
    
    function _log(msg) {
        self.postMessage({log: msg });
    }

    function _stopwatch(name, fun) {
        var startDate = new Date(),
            start = startDate.getTime(),
            result = fun(),
            stopDate = new Date(),
            diff = stopDate.getTime() - start;

        _log("Time (" + name + "): " + diff);
        return result;
    }

    importScripts('esprima/esprima.js', 'scope.js');
    
    var outerScope = null,
        identifiers = null,
        properties = null;
    
    function sift() {
        var idPositions,
            propPositions,
            token,
            key,
            i;
        
        idPositions = outerScope.walkDownIdentifiers(function (acc, token) {
            if (Object.prototype.hasOwnProperty.call(acc, token.name)) {
                acc[token.name].push(token.range[0]);
            } else {
                acc[token.name] = [token.range[0]];
            }
            return acc;
        }, {});
        
        identifiers = [];
        for (key in idPositions) {
            if (Object.prototype.hasOwnProperty.call(idPositions, key)) {
                token = {
                    value: key,
                    positions: idPositions[key]
                };
                identifiers.push(token);
            }
        }
        
        propPositions = outerScope.walkDownProperties(function (acc, token) {
            if (Object.prototype.hasOwnProperty.call(acc, token.name)) {
                acc[token.name].push(token.range[0]);
            } else {
                acc[token.name] = [token.range[0]];
            }
            return acc;
        }, {});
        
        properties = [];
        for (key in propPositions) {
            if (Object.prototype.hasOwnProperty.call(propPositions, key)) {
                token = {
                    value: key,
                    positions: propPositions[key]
                };
                properties.push(token);
            }
        }
    }

    function parse(text, newpath) {
        try {
            self.postMessage({log: "Parsing ..."});
            var ast = _stopwatch("parse", function () {
                    return esprima.parse(text, {
                        range       : true,
                        tolerant    : true
                    });
                });
            
            self.postMessage({log: "Building outer scope..."});
            
            _stopwatch("scope", function () {
                outerScope = new self.Scope(ast);
            });
            
            if (ast.errors.length > 0) {
                self.postMessage({log: "Parse errors: " + JSON.stringify(ast.errors)});
            }
            
            sift();
            
            return true;
        } catch (err) {
            self.postMessage({log: "Parsing failed: " + err});
            return false;
        }
    }
    
    self.addEventListener("message", function (e) {
        var type = e.data.type;
        
        if (type === "outerScope") {
            var text    = e.data.text,
                newpath = e.data.path,
                success = parse(text, newpath),
                result  = {
                    type        : type,
                    path        : newpath,
                    scope       : outerScope,
                    identifiers : identifiers,
                    properties  : properties,
                    success     : success
                };
            
            self.postMessage(result);
        } else {
            self.postMessage({
                log : "Unknown message: " + JSON.stringify(e.data)
            });
        }
    });
}());