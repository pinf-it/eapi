
const VERBOSE = false;

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

            async function applyChanges (type, path, parent) {
                if (!changes[path.join('/')]) {
                    return false;
                }
                await Promise.all(changes[path.join('/')].map(async function (change) {

                    log(`Applying change to '${path.join('/')}':`, change);

                    change.entity = type;
                    change.mountPropertyPath = path.concat(change.name);

                    layerChanges.push(change);

                    try {
                        const adapterName = type.split(':')[0];
                        if (!self.instance.adapters[adapterName]) {
                            throw new Error(`No handlers found for '${adapterName}'!`);
                        }
                        if (!self.instance.adapters[adapterName].handlers[change.action]) {
                            throw new Error(`Handler for '${adapterName}:${change.action}' not found!`);
                        }

                        const response = await self.instance.adapters[adapterName].handlers[change.action](change.name, change.config, parent, change.existingConfig);
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

            async function forLayer (DECLARATIONS, type, path, parent, _repeatedLayerRun) {
                path = path || [];

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
                            console.error("parent", parent);
                            throw new Error(`No handlers found for '${typeParts[0]}'!`);
                        }
                        typeParts[1] = typeParts[1] || 'get';
                        if (!self.instance.adapters[typeParts[0]].handlers[typeParts[1]]) {
                            console.error("path", path);
                            console.error("parent", parent);
                            throw new Error(`Handler for '${type}' not found!`);
                        }

                        log(`Calling:`, path.join('/'));
                        
                        const response = await self.instance.adapters[typeParts[0]].handlers[typeParts[1]](parent, path);

                        log(`Response:`, response);

                        if (!response || !response.items) {
                            existing[path.join('/')] = response.items;
                            after[path.join('/')] = LODASH.merge({}, response.items);

                            return Promise.all(Object.keys(DECLARATIONS).map(async function (key) {
                                if (/^@/.test(key)) {
                                    return forLayer(DECLARATIONS[key], key, path.concat(key), after[path.join('/')]);
                                }
                            }));
                        }

                        const items = response.items;

                        existing[path.join('/')] = items;
                        after[path.join('/')] = LODASH.merge({}, items);
                        delete changes[path.join('/')];

                        const added = LODASH.difference(Object.keys(DECLARATIONS), Object.keys(items), response.ignoreNames || []);
                        const removed = LODASH.difference(Object.keys(items), Object.keys(DECLARATIONS), response.ignoreNames || []);
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
                            
                            if (response.ignoreConfigProperties) {
                                TRAVERSE(response.ignoreConfigProperties).forEach(function (node) {
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
                                        node === 'EXPECTED' ||
                                        /^function EXPECTED /.test(node.toString())
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
                                        node === 'EXISTING' ||
                                        /^function EXISTING /.test(node.toString())
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
                                    config: removeContexts(DECLARATIONS[name])
                                });
                            });
                        }
                        if (removed.length) {
                            removed.forEach(function (name) {
                                changes[path.join('/')] = changes[path.join('/')] || [];
                                changes[path.join('/')].push({
                                    action: 'delete',
                                    name: name,
                                    config: removeContexts(existing[path.join('/')][name])
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
                                        config: expectedConfig,
                                        existingConfig: removeContexts(items[name]),
                                        diff: diff
                                    });
                                }
                            });
                        }

                        if (typeof changes[path.join('/')] !== 'undefined') {
                            if (_repeatedLayerRun) {
                                throw new Error(`Layer for type '${type}' and path '${path}' generated changes on verification run!`);
                            }
                        }

                        const changesApplied = await applyChanges(type, path, parent);

                        if (changesApplied) {
                            if (!_repeatedLayerRun) {
                                // Re-run the current layer now that a resource has been created/deleted or updated.

                                log(`Re-run after changes:`, path.join('/'));

                                return forLayer(DECLARATIONS, type, path, parent, true);
                            } else {
                                throw new Error("This should never be reached as the '_repeatedLayerRun' check above should have thrown!");
                            }
                        }

//console.log("existing", JSON.stringify(existing, null, 4));
//console.log("DECLARATIONS", JSON.stringify(DECLARATIONS, null, 4));                        

                        return Promise.all(Object.keys(DECLARATIONS).map(async function (name) {
                            if (existing[path.join('/')][name]) {
                                
                                const subLayerPaths = [];

                                TRAVERSE(DECLARATIONS[name]).map(function (node) {
                                    if (/^@/.test(this.key)) {
                                        subLayerPaths.push([name].concat(this.path));
                                    }
                                });

                                if (!subLayerPaths.length) {
                                    return;
                                }

                                return Promise.all(subLayerPaths.map(function (subLayerPath) {

                                    //async function forLayer (DECLARATIONS, type, path, parent)
                                    return forLayer(
                                        LODASH.get(DECLARATIONS, subLayerPath),
                                        subLayerPath[subLayerPath.length - 1],
                                        subLayerPath,
                                        existing[path.join('/')][name]
                                    );
                                }));
                            }
                        }));
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

