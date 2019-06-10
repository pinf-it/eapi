
const VERBOSE = true;

const UTIL = require("util");
const PATH = require("path");
const DIFF = require("deep-object-diff").detailedDiff;
const LODASH = require("lodash");
const TRAVERSE = require("traverse");


function log (label, obj) {
    if (VERBOSE) console.error(`[eapply] ${label}:`, UTIL.inspect(obj, false, 4, true));
}


class Config {

    constructor (config) {
        this['#'] = 'Config';
        this.config = config;
    }
}

class EntityModel {

    constructor (adapters) {
        this['#'] = 'EntityModel';
        this.adapters = adapters;
    }

}

class EntityAdapter {

    static MapFromAdapters (adapters) {
        const map = {};
        Object.keys(adapters).map(function (name) {
            map[name] = new EntityAdapter(name, adapters[name]);
        });
        return map;
    }

    constructor (name, handlers) {
        this['#'] = 'EntityAdapter';
        this.handlers = handlers;
    }
}

class Transaction {

    constructor (instance) {
        this['#'] = 'Transaction';
        this.instance = instance;
        this.status = 'init';
        this.changes = [];
        this.configBefore = null;
        this.configAfter = null;
    }

    async apply (config) {
        const self = this;

        self.status = 'applying';

        try {

            const existingPrior = {};
            const layerChanges = [];

            const existing = {};
            const changes = {};
            const after = {};

            async function applyChanges (type, path, parents) {
                if (!changes[path.join('/')]) {
                    return false;
                }
                await Promise.all(changes[path.join('/')].map(async function (change) {

                    log(`Applying change to '${path.join('/')}':`, change);

                    change.entity = type;
                    change.treePath = path.concat(change.name);

                    try {
                        const adapterName = type.split(':')[0];
                        if (!self.instance.adapters[adapterName]) {
                            throw new Error(`No handlers found for '${adapterName}'!`);
                        }
                        if (!self.instance.adapters[adapterName].handlers[change.action]) {
                            throw new Error(`Handler for '${adapterName}:${change.action}' not found!`);
                        }

                        const frozenChange = LODASH.cloneDeep(change);

                        log(`Apply change to '${change.name}':`, change.request);

                        const response = await self.instance.adapters[adapterName].handlers[change.action](change.name, change.request, parents, change.existingConfig);

                        frozenChange.response = response;

                        log("Applied change:", frozenChange);

                        layerChanges.push(frozenChange);

                        if (change.action === 'delete') {
                            delete after[path.join('/')][change.name];
                        } else
                        if (change.action === 'create') {
                            after[path.join('/')][change.name] = response;
                        }
                    } catch (err) {
                        log(`ERROR while applying changes to '${path.concat(change.name).join('/')}':`, err);
                        throw err;
                    }
                }));
                return true;
            }

            async function forLayer (DECLARATIONS, type, path, parents, _repeatedLayerRun) {
                path = path || [];
                parents = parents || {};

                try {

                    if (!type) {

                        return Promise.all(Object.keys(DECLARATIONS).map(async function (key) {
                            if (/^@/.test(key)) {
                                return forLayer(DECLARATIONS[key], key, path.concat(key));
                            }
                        }));
                
                    } else {

                        const typeParts = type.split(':');

                        if (!self.instance.adapters[typeParts[0]]) {
                            console.error("path", path);
                            console.error("parents", parents);
                            throw new Error(`No handlers found for '${typeParts[0]}'!`);
                        }
                        typeParts[1] = typeParts[1] || 'get';
                        if (!self.instance.adapters[typeParts[0]].handlers[typeParts[1]]) {
                            console.error("path", path);
                            console.error("parents", parents);
                            throw new Error(`Handler for '${type}' not found!`);
                        }

                        log(`Calling:`, path.join('/'));
                        
                        const response = await self.instance.adapters[typeParts[0]].handlers[typeParts[1]](parents, path);

                        log(`Response for '${type}':`, response);

                        let entityType = "items.map";
                        if (!response || !response.items) {
                            entityType = "object";

                            existing[path.join('/')] = response;
                            after[path.join('/')] = LODASH.merge({}, response);

                            // TODO: Repeat request and eventually quit.
                            //throw new Error(`No items in response!`);
                            /*
                            return Promise.all(Object.keys(DECLARATIONS).map(async function (key) {
                                if (/^@/.test(key)) {
                                    return forLayer(DECLARATIONS[key], key, path.concat(key), after[path.join('/')]);
                                }
                            }));
                            */
                        } else {

                            const items = response.items;

                            existing[path.join('/')] = items;
                            after[path.join('/')] = LODASH.merge({}, items);
                            delete changes[path.join('/')];

                            const added = LODASH.difference(Object.keys(DECLARATIONS), Object.keys(items), response.ignoreKeys || []);
                            const removed = LODASH.difference(Object.keys(items), Object.keys(DECLARATIONS), response.ignoreKeys || []);
                            const keeping = LODASH.difference(Object.keys(DECLARATIONS), added, removed);

                            function removeContexts (config) {
                                return TRAVERSE(config).map(function (node) {
                                    if (/^@/.test(this.key)) {
                                        this.delete(true);
                                    }
                                });
                            }

                            // TODO: Optionally use https://github.com/epoberezkin/ajv#filtering-data
                            function removeProperties (expectedConfig, existingConfig) {
                                expectedConfig = LODASH.merge({}, expectedConfig);
                                existingConfig = LODASH.merge({}, existingConfig);
                                
                                if (response.propertyOptions) {
                                    TRAVERSE(response.propertyOptions).forEach(function (node) {
                                        const path = this.path;
                                        function pathsForConfig (config, checkValue) {
                                            const paths = [];
                                            let foundArray = false;
                                            path.forEach(function (pathSegment, i) {
                                                if (pathSegment === '0') {
                                                    foundArray = true;
                                                    const items = LODASH.get(config, path.slice(0, i), undefined);
                                                    if (items !== undefined) {
                                                        for (let j=0; j<items.length; j++) {
                                                            if (
                                                                typeof checkValue !== "function" ||
                                                                checkValue(items[j])
                                                            ) {
                                                                paths.push(path.slice(0, i).concat(`${j}`, path.slice(i+1)).concat());
                                                            }
                                                        }
                                                    }
                                                }
                                            });
                                            if (!foundArray) {
                                                paths.push(path);
                                            }
                                            return paths;
                                        }
                                        if (
                                            node === 'CREATE_ONLY' ||
                                            /^function CREATE_ONLY /.test(node.toString())
                                        ) {
                                            pathsForConfig(expectedConfig, node).forEach(function (path) {
                                                // Ignore properties that are expected and do not exist
                                                if (LODASH.get(existingConfig, path, undefined) === undefined) {
                                                    if (LODASH.get(expectedConfig, path, undefined) !== undefined) {
                                                        LODASH.unset(expectedConfig, path);
                                                    }
                                                }
                                            });
                                        } else
                                        if (
                                            node === 'IMMUTABLE_RESPONSE' ||
                                            /^function IMMUTABLE_RESPONSE /.test(node.toString())
                                        ) {
                                            pathsForConfig(existingConfig, node).forEach(function (path) {
                                                // Ignore properties that exist and are not expected
                                                if (LODASH.get(expectedConfig, path, undefined) === undefined) {
                                                    if (LODASH.get(existingConfig, path, undefined) !== undefined) {
                                                        LODASH.unset(existingConfig, path);
                                                    }
                                                }
                                            });
                                        }
                                    });
                                }

                                return {
                                    expectedConfig: expectedConfig,
                                    existingConfig: existingConfig
                                }
                            }

                            if (added.length) {
                                added.forEach(function (name) {
                                    changes[path.join('/')] = changes[path.join('/')] || [];
                                    changes[path.join('/')].push({
                                        action: 'create',
                                        name: name,
                                        request: removeContexts(DECLARATIONS[name])
                                    });
                                });
                            }
                            if (removed.length) {
                                removed.forEach(function (name) {
                                    changes[path.join('/')] = changes[path.join('/')] || [];
                                    changes[path.join('/')].push({
                                        action: 'delete',
                                        name: name,
                                        request: removeContexts(existing[path.join('/')][name])
                                    });
                                });
                            }
                            if (keeping.length) {
                                keeping.forEach(function (name) {

                                    const { expectedConfig, existingConfig } = removeProperties(removeContexts(DECLARATIONS[name]), removeContexts(items[name]));

//console.log("expectedConfig", JSON.stringify(expectedConfig, null, 4));
//console.log("existingConfig", JSON.stringify(existingConfig, null, 4));

                                    const diff = DIFF(expectedConfig, existingConfig);
                                    if (
                                        Object.keys(diff.added).length ||
                                        Object.keys(diff.deleted).length ||
                                        Object.keys(diff.updated).length
                                    ) {
                                        changes[path.join('/')] = changes[path.join('/')] || [];
                                        changes[path.join('/')].push({
                                            action: 'update',
                                            name: name,
                                            request: expectedConfig,
                                            existingConfig: removeContexts(items[name]),
                                            diff: diff
                                        });
                                    }
                                });
                            }

                            if (typeof changes[path.join('/')] !== 'undefined') {
                                if (_repeatedLayerRun) {
                                    console.error("changes:", JSON.stringify(changes, null, 4));
                                    throw new Error(`Layer for type '${type}' and path '${path}' generated changes on verification run!`);
                                }
                            }

                            const changesApplied = await applyChanges(type, path, parents);

                            if (changesApplied) {
                                if (!_repeatedLayerRun) {
                                    // Re-run the current layer now that a resource has been created/deleted or updated.

                                    log(`Re-run after changes:`, path.join('/'));

                                    return forLayer(DECLARATIONS, type, path, parents, true);
                                } else {
                                    throw new Error("This should never be reached as the '_repeatedLayerRun' check above should have thrown!");
                                }
                            }
                        }

//console.log("existing", JSON.stringify(existing, null, 4));
//console.log("DECLARATIONS", JSON.stringify(DECLARATIONS, null, 4));

                        async function forNode (config, layerParents, subLayerBasePath) {

                            const subLayerPaths = [];

                            TRAVERSE(config).map(function (node) {
                                if (/^@/.test(this.key)) {
                                    subLayerPaths.push(this.path);
                                    this.update(node, true);
                                }
                            });
                
                            if (!subLayerPaths.length) {
                                return;
                            }
                
//console.log("subLayerPaths", subLayerPaths);
                
                            return Promise.all(subLayerPaths.map(function (subLayerPath) {
                
                                //async function forLayer (DECLARATIONS, type, path, parent)
                                return forLayer(
                                    LODASH.get(config, subLayerPath),
                                    subLayerPath[subLayerPath.length - 1],
                                    [].concat(subLayerBasePath).concat(subLayerPath),
                                    layerParents
                                );
                            }));                            
                        }

                        if (entityType === "items.map") {

                            let hasPending = false;
                            await Promise.all(Object.keys(DECLARATIONS).map(async function (name) {
                                if (existing[path.join('/')][name]) {

                                    const layerParents = LODASH.clone(parents);
                                    layerParents[type] = after[path.join('/')][name];

                                    return forNode(DECLARATIONS[name], layerParents, [].concat(path).concat([name]));
                                } else {
                                    hasPending = true;
                                }
                            }));

                            if (hasPending) {
throw new Error("Has pending!");
                            }

                            return;

                        } else
                        if (entityType === "object") {

                            if (!existing[path.join('/')]) {
throw new Error("Repeat until it exists!");
                            }

                            const layerParents = LODASH.clone(parents);
                            layerParents[type] = after[path.join('/')];

                            return forNode(DECLARATIONS, layerParents, [].concat(path));

                        } else {
                            throw new Error(`entityType '${entityType}' not supported!`);
                        }
                    }
                } catch (err) {
                    log(`ERROR while processing layer '${path.join('/')}':`, err);
                    throw err;
                }
            }

            await forLayer(config.config);

            log("After:", after);
            log("Changes:", changes);

            self.status = 'done';

            //console.log('==> Success! Everything should be up and running! <==');

            self.changes = layerChanges;
            self.configBefore = existingPrior;
            self.configAfter = after;

        } catch (err) {
            self.status = 'error';
            throw err;
        }
        return this;
    }
}


exports.apply = async function (config, adapters) {

    const model = new EntityModel(EntityAdapter.MapFromAdapters(adapters));
    const transaction = new Transaction(model);

    return transaction.apply(new Config(config)).then(function () {

        return transaction;
    });
}

