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

        function _buildAssociations(object, property, parent) {
            if (property.type === "Identifier") {
                if (object.type === "Identifier") {
                    parent.addAssociation(object, property);
                } else if (object.type === "MemberExpression") {
                    if (object.computed === false) {
                        _buildAssociations(object.property, property, parent);
                    }
                } else {
                    // most likely a call expression or a literal
                    return;
                }
            } else {
                // Because we restrict to non-computed property lookups, this
                // should be unreachable
                throw "Expected identifier but found " + property.type;
            }
        }

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
                parent.addDeclaration(tree.id);
                _buildScope(tree.id, parent);
                child = new Scope(tree, parent);
                child.addAllDeclarations(tree.params);
                tree.params.forEach(function (t) {
                    _buildScope(t, child);
                });
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
                parent.addDeclaration(tree.id);
                _buildScope(tree.id, parent);
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
                child.addDeclaration(tree.param);
                _buildScope(tree.param, child);
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
                if (tree.computed === false) {
                    _buildAssociations(tree.object, tree.property, parent);
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
                    parent.addDeclaration(tree.id);
                    _buildScope(tree.id, parent);
                }
                child = new Scope(tree, parent);
                parent.addChildScope(child);
                child.addAllDeclarations(tree.params);
                tree.params.forEach(function (t) {
                    _buildScope(t, child);
                });
                _buildScope(tree.body, child);
                break;

            case "Property":
                // Undocumented or Esprima-specific?
                parent.addProperty(tree.key);
                _buildScope(tree.value, parent);
                break;

            case "Identifier":
                parent.addIdOccurrence(tree);
                break;

            case "DebuggerStatement":
            case "EmptyStatement":
            case "ThisExpression":
            case "Literal":
                break;

            default:
                throw "Unknown node type: " + tree.type;
            }
        }
        
        function _rebuildScope(scope, data) {
            var child, i;
            scope.range = data.range;
            scope.idDeclarations = data.idDeclarations;
            scope.idOccurrences = data.idOccurrences;
            scope.propOccurrences = data.propOccurrences;
            scope.associations = data.associations;
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

        if (obj.idDeclarations && obj.range) {
            // the object is a data-only Scope object
            _rebuildScope(this, obj);
        } else {
            // the object is an AST
            this.idDeclarations = [];
            this.idOccurrences = [];
            this.propOccurrences = [];
            this.associations = [];

            this.children = []; // disjoint ranges, ordered by range start
            this.range = { start: obj.range[0], end: obj.range[1] };
        
            // if parent is null, walk the AST 
            if (!this.parent) {
                _buildScope(obj, this);
            }
        }
    }
    
    Scope.prototype.addDeclaration = function (id) {
        this.idDeclarations.push(id);
    };
    
    Scope.prototype.addAllDeclarations = function (ids) {
        var that = this;
        ids.forEach(function (i) {
            that.idDeclarations.push(i);
        });
    };
    
    Scope.prototype.addIdOccurrence = function (id) {
        this.idOccurrences.push(id);
    };

    Scope.prototype.addProperty = function (prop) {
        this.propOccurrences.push(prop);
    };

    Scope.prototype.addAssociation = function (obj, prop) {
        this.associations.push({object: obj, property: prop});
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
        
        if (this.range.start <= pos && pos <= this.range.end) {
            for (i = 0; i < this.children.length; i++) {
                if (this.children[i].range.start <= pos &&
                        pos <= this.children[i].range.end) {
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
        
        for (i = 0; i < this.idDeclarations.length; i++) {
            if (this.idDeclarations[i].name === sym) {
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
        return this.range.start <= pos && pos <= this.range.end;
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
    Scope.prototype.walkDown = function (add, init) {
        var result = add(this, init);
        
        this.children.forEach(function (child) {
            result = child.walkDown(add, result);
        });
        
        return result;
    };

    Scope.prototype.walkDownList = function (addItem, init, listName) {
        function addList(scope, init) {
            var list = scope[listName];
            return list.reduce(function (prev, curr) {
                return addItem(prev, curr);
            }, init);
        }
        
        return this.walkDown(addList, init);
    };
        
    Scope.prototype.walkDownDeclarations = function (add, init) {
        return this.walkDownList(add, init, 'idDeclarations');
    };

    Scope.prototype.walkDownIdentifiers = function (add, init) {
        return this.walkDownList(add, init, 'idOccurrences');
    };

    Scope.prototype.walkDownProperties = function (add, init) {
        return this.walkDownList(add, init, 'propOccurrences');
    };

    Scope.prototype.walkDownAssociations = function (add, init) {
        return this.walkDownList(add, init, 'associations');
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
    
    Scope.prototype.walkUpDeclarations = function (add, init) {
        return this.walkUp(add, init, 'idDeclarations');
    };
    
    Scope.prototype.walkUpIdentifiers = function (add, init) {
        return this.walkUp(add, init, 'idOccurrences');
    };

    Scope.prototype.walkUpProperties = function (add, init) {
        return this.walkUp(add, init, 'propOccurrences');
    };
    
    Scope.prototype.getAllDeclarations = function () {
        var ids = [],
            scope = this;

        do {
            ids = ids.concat(this.idDeclarations);
            scope = scope.parent;
        } while (scope !== null);
        return ids;
    };

    Scope.prototype.toStringBelow = function () {
        return "[" + this.range.start + " " + this.idDeclarations.map(function (i) {
            return i.name;
        }).join(", ") +
            " : " + (this.children.map(function (c) {
                return c.toString();
            }).join("; ")) + this.range.end + "]";
    };

    Scope.prototype.toString = function () {
        return "[" + this.range.start + " " + this.idDeclarations.map(function (i) {
            return i.name;
        }).join(", ") + this.range.end + "]";
    };

    exports.Scope = Scope;
});
