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
/*global define */

define(function (require, exports, module) {
    "use strict";
    
    function Scope(obj, parent) {

        function _buildScope(tree, parent) {
            var child;

            if (tree === undefined || tree === null) {
                return;
            }

            switch (tree.type) {
            case "Program":
            case "BlockStatement":
                tree.body.forEach(function (t) {
                    _buildScope(t, parent);
                });
                break;

            case "FunctionDeclaration":
                parent.addIdentifier(tree.id);
                child = new Scope(tree, parent);
                child.addAllIdentifiers(tree.params);
                parent.addChildScope(child);
                _buildScope(tree.body, child);
                break;

            case "VariableDeclaration":
                // FIXME handle let scoping
                tree.declarations.forEach(function (t) {
                    _buildScope(t, parent);
                });
                break;

            case "VariableDeclarator":
                parent.addIdentifier(tree.id);
                if (tree.init !== null) {
                    _buildScope(tree.init, parent);
                }
                break;

            case "ExpressionStatement":
                _buildScope(tree.expression, parent);
                break;

            case "SwitchStatement":
                _buildScope(tree.discriminant, parent);
                if (tree.cases) {
                    tree.cases.forEach(function (t) {
                        _buildScope(t, parent);
                    });
                }
                break;

            case "SwitchCase":
                tree.consequent.forEach(function (t) {
                    _buildScope(t, parent);
                });
                if (tree.test) {
                    _buildScope(tree.test, parent);
                }
                break;

            case "TryStatement":
                tree.handlers.forEach(function (t) {
                    _buildScope(t, parent);
                });
                _buildScope(tree.block, parent);
                if (tree.finalizer) {
                    _buildScope(tree.finalizer, parent);
                }
                break;

            case "ThrowStatement":
                _buildScope(tree.argument, parent);
                break;

            case "WithStatement":
                _buildScope(tree.object, parent);
                _buildScope(tree.body, parent);
                break;

            case "CatchClause":
                if (tree.guard) {
                    _buildScope(tree.guard, parent);
                }
                // FIXME: Is this the correct way to handle catch?
                child = new Scope(tree, parent);
                child.addIdentifier(tree.param);
                parent.addChildScope(child);
                _buildScope(tree.body, child);
                break;

            case "ReturnStatement":
                if (tree.argument) {
                    _buildScope(tree.argument, parent);
                }
                break;

            case "ForStatement":
                _buildScope(tree.body, parent);
                if (tree.init) {
                    _buildScope(tree.init, parent);
                }
                if (tree.test) {
                    _buildScope(tree.test, parent);
                }
                if (tree.update) {
                    _buildScope(tree.update, parent);
                }
                break;

            case "ForInStatement":
                _buildScope(tree.left, parent);
                _buildScope(tree.right, parent);
                _buildScope(tree.body, parent);
                break;

            case "LabeledStatement":
                _buildScope(tree.body, parent);
                break;

            case "BreakStatement":
            case "ContinueStatement":
                if (tree.label) {
                    _buildScope(tree.label, parent);
                }
                break;

            case "UpdateExpression":
            case "UnaryExpression":
                _buildScope(tree.argument, parent);
                break;

            case "IfStatement":
            case "ConditionalExpression":
                _buildScope(tree.test, parent);
                _buildScope(tree.consequent, parent);
                if (tree.alternate) {
                    _buildScope(tree.alternate, parent);
                }
                break;

            case "WhileStatement":
            case "DoWhileStatement":
                _buildScope(tree.test, parent);
                _buildScope(tree.body, parent);
                break;

            case "SequenceExpression":
                tree.expressions.forEach(function (t) {
                    _buildScope(t, parent);
                });
                break;

            case "ObjectExpression":
                tree.properties.forEach(function (t) {
                    _buildScope(t, parent);
                });
                break;

            case "ArrayExpression":
                tree.elements.forEach(function (t) {
                    _buildScope(t, parent);
                });
                break;

            case "NewExpression":
                if (tree['arguments']) { // pacifies JSLint
                    tree['arguments'].forEach(function (t) {
                        _buildScope(t, parent);
                    });
                }
                _buildScope(tree.callee, parent);
                break;

            case "BinaryExpression":
            case "AssignmentExpression":
            case "LogicalExpression":
                _buildScope(tree.left, parent);
                _buildScope(tree.right, parent);
                break;

            case "MemberExpression":
                _buildScope(tree.object, parent);
                _buildScope(tree.property, parent);
                if (tree.property && tree.property.type === "Identifier") {
                    parent.addProperty(tree.property);
                }
                break;

            case "CallExpression":
                tree['arguments'].forEach(function (t) {
                    _buildScope(t, parent);
                });
                _buildScope(tree.callee, parent);
                break;

            case "FunctionExpression":
                if (tree.id) {
                    parent.addIdentifier(tree.id);
                }
                child = new Scope(tree, parent);
                parent.addChildScope(child);
                child.addAllIdentifiers(tree.params);
                _buildScope(tree.body, child);
                break;

            case "Property":
                // Undocumented or Esprima-specific?
                parent.addProperty(tree.key);
                _buildScope(tree.value, parent);
                break;

            case "DebuggerStatement":
            case "EmptyStatement":
            case "ThisExpression":
            case "Identifier":
            case "Literal":
                break;

            default:
                throw "Unknown node type: " + tree.type;
            }
        }
        
        function _rebuildScope(scope, data) {
            var child, i;
            scope.identifiers = data.identifiers;
            scope.range = data.range;
            scope.properties = data.properties;
            scope.children = [];
            
            for (i = 0; i < data.children.length; i++) {
                child = new Scope(data.children[i], scope);
                scope.children.push(child);
            }
        }
        
        if (parent === undefined) {
            this.parent = null;
        } else {
            this.parent = parent;
        }

        if (obj.identifiers && obj.range) {
            // the object is a data-only Scope object
            _rebuildScope(this, obj);
        } else {
            // the object is an AST
            this.properties = [];
            this.identifiers = [];
            this.children = []; // disjoint ranges, ordered by range start
            this.range = { start: obj.range[0], end: obj.range[1] };
        
            // if parent is null, walk the AST 
            if (!this.parent) {
                _buildScope(obj, this);
            }
        }
        if (this.parent === undefined) {
            console.log("oops");
        }
    }
    
    Scope.prototype.addIdentifier = function (id) {
        this.identifiers.push(id);
    };
    
    Scope.prototype.addAllIdentifiers = function (ids) {
        var that = this;
        ids.forEach(function (i) {
            that.identifiers.push(i);
        });
    };
    
    Scope.prototype.addProperty = function (prop) {
        this.properties.push(prop);
    };

    Scope.prototype.addChildScope = function (child) {
        var i = 0;
        
        while (i < this.children.length &&
                child.range.start > this.children[i].range.end) {
            i++;
        }
        this.children.splice(i, 0, child);
    };
    
    Scope.prototype.findChild = function (pos) {
        var i;
        
        if (this.range.start <= pos && pos < this.range.end) {
            for (i = 0; i < this.children.length; i++) {
                if (this.children[i].range.start <= pos &&
                        pos < this.children[i].range.end) {
                    return this.children[i].findChild(pos);
                }
            }
            // if no child has a matching range, this is the most precise scope
            return this;
        } else {
            return null;
        }
    };
    
    Scope.prototype.member = function (sym) {
        var i;
        
        for (i = 0; i < this.identifiers.length; i++) {
            if (this.identifiers[i].name === sym) {
                return true;
            }
        }
        return false;
    };
    
    Scope.prototype.contains = function (sym) {
        var depth = 0,
            child = this;
        
        do {
            if (child.member(sym)) {
                return depth;
            } else {
                child = child.parent;
                depth++;
            }
        } while (child !== null);
        
        return undefined;
    };
    
    Scope.prototype.containsPosition = function (pos) {
        return this.range.start <= pos && pos < this.range.end;
    };
    
    Scope.prototype.containsPositionImmediate = function (pos) {
        var children = this.children,
            i;
        
        // is in the scope's range...
        if (this.containsPosition(pos)) {
            for (i = 0; i < children.length; i++) {
                // but not in a child's scope
                if (children[i].containsPosition(pos)) {
                    return false;
                }
            }
            return true;
        } else {
            return false;
        }
    };
    
    /**
     * Traverse the scope down via children
     */
    Scope.prototype.walkDown = function (add, init, prop) {
        var result = init,
            i;
        
        for (i = 0; i < this[prop].length; i++) {
            result = add(result, this[prop][i]);
        }
        
        for (i = 0; i < this.children.length; i++) {
            result = this.children[i].walkDown(add, result, prop);
        }
        
        return result;
    };
        
    Scope.prototype.walkDownIdentifiers = function (add, init) {
        return this.walkDown(add, init, 'identifiers');
    };

    Scope.prototype.walkDownProperties = function (add, init) {
        return this.walkDown(add, init, 'properties');
    };
    
    /**
     * Traverse the scope up via the parent
     */
    Scope.prototype.walkUp = function (add, init, prop) {
        var scope = this,
            result = init,
            i;
        
        while (scope !== null) {
            for (i = 0; i < this[prop].length; i++) {
                result = add(result, this[prop][i]);
            }
            scope = scope.parent;
        }
        
        return result;
    };
    
    Scope.prototype.walkUpProperties = function (add, init) {
        return this.walkUp(add, init, 'properties');
    };
    
    Scope.prototype.walkUpIdentifiers = function (add, init) {
        return this.walkUp(add, init, 'identifiers');
    };
    
    Scope.prototype.getAllIdentifiers = function () {
        var ids = [],
            scope = this;

        do {
            ids = ids.concat(this.identifiers);
            scope = scope.parent;
        } while (scope !== null);
        return ids;
    };

    Scope.prototype.toStringBelow = function () {
        return "[" + this.range.start + " " + this.identifiers.map(function (i) {
            return i.name;
        }).join(", ") +
            " : " + (this.children.map(function (c) {
                return c.toString();
            }).join("; ")) + this.range.end + "]";
    };

    Scope.prototype.toString = function () {
        return "[" + this.range.start + " " + this.identifiers.map(function (i) {
            return i.name;
        }).join(", ") + this.range.end + "]";
    };

    exports.Scope = Scope;
});
