// Copyright (c) 2017-present Mattermost, Inc. All Rights Reserved.
// See License.txt for license information.

import {Node} from 'commonmark';

// Add indices to the items of every list
export function addListItemIndices(ast) {
    const walker = ast.walker();

    let e;
    while ((e = walker.next())) {
        if (e.entering) {
            const node = e.node;

            if (node.type === 'list') {
                let i = node.listStart || 1; // List indices match what would be displayed in the UI

                for (let child = node.firstChild; child; child = child.next) {
                    child.index = i;

                    i += 1;
                }
            }
        }
    }

    return ast;
}

export function pullOutImages(ast) {
    for (let block = ast.firstChild; block !== null; block = block.next) {
        let node = block.firstChild;

        let cameFromChild = false;

        while (node && node !== block) {
            // TODO look for images
            if (node.type === 'image' && node.parent.type !== 'document') {
                const image = node;

                let parent = image.parent;
                let prev = image.prev;
                let next = image.next;

                // Remove image from its siblings
                if (prev) {
                    prev._next = next;
                }
                if (next) {
                    next._prev = prev;
                }

                // And from its parents
                if (parent._firstChild === image) {
                    // image was the first child (ie prev is null), so the next sibling is now the first child
                    parent._firstChild = next;
                }
                if (parent._lastChild === image) {
                    // image was the last child (ie next is null), so the previous sibling is now the last child
                    parent._lastChild = prev;
                }

                // Split the tree between the previous and next siblings, where the image would've been
                while (parent && parent.type !== 'document') {
                    // We only need to split the parent if there's anything on the right of where we're splitting
                    // in the current branch
                    let parentCopy = null;

                    // Split if we have children to the right of the split (next) or if we have any siblings to the
                    // right of the parent (parent.next)
                    if (next || parent.next) {
                        parentCopy = copyNodeWithoutNeighbors(parent);

                        // Set an additional flag so we know not to re-render things like bullet points
                        parentCopy.continue = true;

                        // Re-assign the children to the right of the split to belong to the copy
                        parentCopy._firstChild = next;
                        parentCopy._lastChild = getLastSibling(next);

                        if (parent._firstChild === next) {
                            parent._firstChild = null;
                            parent._lastChild = null;
                        } else {
                            parent._lastChild = prev;
                        }

                        // And re-assign the parent of all of those to be the copy
                        for (let child = parentCopy.firstChild; child; child = child.next) {
                            child._parent = parentCopy;
                        }

                        // Insert the copy as parent's next sibling
                        if (parent.next) {
                            parent.next._prev = parentCopy;
                            parentCopy._next = parent.next;
                            parent._next = parentCopy;
                        } else /* if (parent.parent.lastChild === parent) */ {
                            // Since parent has no next sibling, parent is the last child of its parent, so
                            // we need to set the copy as the last child
                            parent.parent.lastChild = parentCopy;
                        }
                    }

                    // Change prev and next to no longer be siblings
                    if (prev) {
                        prev._next = null;
                    }

                    if (next) {
                        next._prev = null;
                    }

                    // Move up the tree
                    next = parentCopy;
                    prev = parent;
                    parent = parent.parent;
                }

                // Re-insert the image now that we have a tree split down to the root with the image's ancestors.
                // Note that parent is the root node, prev is the ancestor of image, and next is the ancestor of the copy

                // Add image to its parent
                image._parent = parent;
                if (next) {
                    parent._lastChild = next;
                } else {
                    // image is the last child of the root node now
                    parent._lastChild = image;
                }

                // Add image to its siblings
                image._prev = prev;
                prev._next = image;

                image._next = next;
                if (next) {
                    next._prev = image;
                }

                // The copy still needs its parent set to the root node
                if (next) {
                    next._parent = parent;
                }
            }

            // Walk through tree to next node
            if (node.firstChild && !cameFromChild) {
                node = node.firstChild;
                cameFromChild = false;
            } else if (node.next) {
                node = node.next;
                cameFromChild = false;
            } else {
                node = node.parent;
                cameFromChild = true;
            }
        }
    }

    return ast;
}

// Copies a Node without its parent, children, or siblings
function copyNodeWithoutNeighbors(node) {
    // commonmark uses classes so it takes a bit of work to copy them
    const copy = Object.assign(Object.create(Object.getPrototypeOf(node)), node);

    copy._parent = null;
    copy._firstChild = null;
    copy._lastChild = null;
    copy._prev = null;
    copy._next = null;

    // Deep copy list data since it's an object
    copy._listData = {...node._listData};

    return copy;
}

// Gets the last sibling of a given node
function getLastSibling(node) {
    let sibling = node;

    while (sibling && sibling.next) {
        sibling = sibling.next;
    }

    return sibling;
}

export function verifyAst(node) {
    if (node.prev && node.prev.next !== node) {
        console.error('node is not linked properly to prev');
    }

    if (node.next && node.next.prev !== node) {
        console.error('node is not linked properly to prev');
    }

    for (let child = node.firstChild; child; child = child.next) {
        if (child.parent !== node) {
            console.error('node is not linked properly to child');
        }
    }

    if (node.firstChild && node.firstChild.prev) {
        console.error('node\'s first child has previous sibling');
    }

    if (node.lastChild && node.lastChild.next) {
        console.error('node\'s last child has next sibling');
    }

    return true;
}

export function astToString(node, indent = '') {
    if (!node) {
        return '';
    }

    let out = '';

    out += indent + nodeToString(node) + '\n';

    for (let child = node.firstChild; child !== null; child = child.next) {
        out += astToString(child, indent + '  ');
    }

    return out;
}

const neighbours = ['parent', 'prev', 'next', 'firstChild', 'lastChild'];
const importantFields = ['literal', 'destination', 'title', 'level', 'listType', 'listTight', 'listDelimiter', 'mentionName', 'channelName', 'emojiName', 'continue', 'index'];
function nodeToString(node) {
    let out = node.type;

    for (const neighbour of neighbours) {
        if (node[neighbour]) {
            out += ' ' + neighbour + '=`' + node[neighbour].type;
            if (node[neighbour].type === 'text') {
                out += ':' + node[neighbour].literal;
            }
            out += '`';
        }
    }

    for (const field of importantFields) {
        if (node[field]) {
            out += ' ' + field + '=`' + node[field] + '`';
        }
    }

    return out;
}

const ignoredKeys = {_sourcepos: true, _lastLineBlank: true, _open: true, _string_content: true, _info: true, _isFenced: true, _fenceChar: true, _fenceLength: true, _fenceOffset: true, _onEnter: true, _onExit: true};
export function astToJson(node, visited = [], indent = '') {
    let out = '{';

    visited = [...visited];
    visited.push(node);

    const keys = Object.keys(node).filter((key) => !ignoredKeys[key]);
    if (keys.length > 0) {
        out += '\n';
    }

    for (const [i, key] of keys.entries()) {
        out += indent + '  "' + key + '":'

        const value = node[key];
        if (visited.indexOf(value) !== -1) {
            out += '[Circular]'
        } else if (value === null) {
            out += 'null';
        } else if (typeof value === 'number') {
            out += value;
        } else if (typeof value === 'string') {
            out += '"' + value + '"';
        } else if (typeof value === 'boolean') {
            out += String(value);
        } else if (typeof value === 'object') {
            out += astToJson(value, visited, indent + '  ');
        }

        if (i !== keys.length - 1) {
            out += ',\n';
        }
    }

    if (keys.length > 0) {
        out += '\n' + indent;
    }

    out += '}';

    return out;
}

// Converts an AST represented as a JavaScript object into a full Commonmark-compatitle AST.
// This function is intended for use while testing. An example of input would be:
// {
//     type: 'document',
//     children: [{
//         type: 'heading',
//         level: 2,
//         children: [{
//             type: 'text',
//             literal: 'This is a heading'
//         }]
//     }, {
//         type: 'paragraph',
//         children: [{
//             type: 'text',
//             literal: 'This is a paragraph'
//         }]
//     }]
// }
export function makeAst(input) {
    const {type, children, ...other} = input;

    const node = new Node(type);

    for (const key of Object.keys(other)) {
        node[key] = other[key];
    }

    if (children) {
        for (const child of children) {
            node.appendChild(makeAst(child));
        }
    }

    return node;
}
