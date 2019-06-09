
const ASSERT = require("assert");
const LODASH = require("lodash");
const EAPPLY = require("../..");


describe('eapply', function () {

    class SimpleHandler {

        constructor () {
            const self = this;
            self['#'] = 'Handler';

            const servers = {};

            self.get = function () {
                return {
                    items: servers
                };
            }
            self.create = function (name, config) {
                if (config.name !== config.name) {
                    throw new Error(`'name' property ('${config.name}') in entity must match entity key '${name}'!`);
                }
                servers[name] = config;
                return config;
            }
            self.delete = function (name, config) {
                delete servers[name];
            }
            self.update = function (name, config, parent) {
                if (typeof servers[name] === 'undefined') {
                    throw new Error(`Cannot update entity with name '${name}' as it does not exist.`);
                }
                LODASH.merge(servers[name], config);
            }
        }
    }

    it('Simple', async function () {

        ASSERT.equal(typeof EAPPLY.apply, 'function');

        const result = await EAPPLY.apply({
            "@servers": {
                "server-1": {
                    "name": "server-1"
                }
            }
        }, {
            "@servers": new SimpleHandler()
        });

//        console.log("RESULT", JSON.stringify(result, null, 4));

        ASSERT.deepEqual(JSON.parse(JSON.stringify(result)), {
            "#": "Transaction",
            "instance": {
                "#": "EntityModel",
                "adapters": {
                    "@servers": {
                        "#": "EntityAdapter",
                        "handlers": {
                            "#": "Handler"
                        }
                    }
                }
            },
            "status": "done",
            "changes": [
                {
                    "action": "create",
                    "name": "server-1",
                    "config": {
                        "name": "server-1"
                    },
                    "entity": "@servers",
                    "mountPropertyPath": [
                        "@servers",
                        "server-1"
                    ]
                }
            ],
            "configBefore": {},
            "configAfter": {
                "@servers": {
                    "server-1": {
                        "name": "server-1"
                    }
                }
            }
        });
    });

    it('Multiple & One Directly Nested', async function () {

        ASSERT.equal(typeof EAPPLY.apply, 'function');

        const result = await EAPPLY.apply({
            "@servers": {
                "server-1": {
                    "name": "server-1",
                    "@containers": {
                        "container-1": {
                            "name": "container-1"
                        }
                    }
                },
                "server-2": {
                    "name": "server-2"
                }

            }
        }, {
            "@servers": new SimpleHandler(),
            "@containers": new SimpleHandler()
        });

//        console.log("RESULT", JSON.stringify(result, null, 4));

        ASSERT.deepEqual(JSON.parse(JSON.stringify(result)), {
            "#": "Transaction",
            "instance": {
                "#": "EntityModel",
                "adapters": {
                    "@servers": {
                        "#": "EntityAdapter",
                        "handlers": {
                            "#": "Handler"
                        }
                    },
                    "@containers": {
                        "#": "EntityAdapter",
                        "handlers": {
                            "#": "Handler"
                        }
                    }
                }
            },
            "status": "done",
            "changes": [
                {
                    "action": "create",
                    "name": "server-1",
                    "config": {
                        "name": "server-1"
                    },
                    "entity": "@servers",
                    "mountPropertyPath": [
                        "@servers",
                        "server-1"
                    ]
                },
                {
                    "action": "create",
                    "name": "server-2",
                    "config": {
                        "name": "server-2"
                    },
                    "entity": "@servers",
                    "mountPropertyPath": [
                        "@servers",
                        "server-2"
                    ]
                },
                {
                    "action": "create",
                    "name": "container-1",
                    "config": {
                        "name": "container-1"
                    },
                    "entity": "@containers",
                    "mountPropertyPath": [
                        "server-1",
                        "@containers",
                        "container-1"
                    ]
                }
            ],
            "configBefore": {},
            "configAfter": {
                "@servers": {
                    "server-1": {
                        "name": "server-1"
                    },
                    "server-2": {
                        "name": "server-2"
                    }
                },
                "server-1/@containers": {
                    "container-1": {
                        "name": "container-1"
                    }
                }
            }
        });
    });

/*
    it('Multiple & Multiple Directly Nested', async function () {

        ASSERT.equal(typeof EAPPLY.apply, 'function');

        const result = await EAPPLY.apply({
            "@servers": {
                "server-1": {
                    "name": "server-1",
                    "@containers": {
                        "container-1": {
                            "name": "container-1"
                        }
                    }
                },
                "server-2": {
                    "name": "server-2",
                    "@containers": {
                        "container-2": {
                            "name": "container-2"
                        }
                    }
                }

            }
        }, {
            "@servers": new SimpleHandler(),
            "@containers": new SimpleHandler()
        });
    });
*/
/*
    it('Multiple & Multiple Deeply Nested', async function () {

        ASSERT.equal(typeof EAPPLY.apply, 'function');

        const result = await EAPPLY.apply({
            "@servers": {
                "server-1": {
                    "name": "server-1",
                    "cluster": {
                        "nodes": {
                            "@servers": {
                                "server-3": {
                                    "name": "server-3"
                                }
                            }
                        }
                    }
                },
                "server-2": {
                    "name": "server-2",
                    "cluster": {
                        "nodes": {
                            "@servers": {
                                "server-4": {
                                    "name": "server-4"
                                }
                            }
                        }
                    }
                }
            }
        }, {
            "@servers": new SimpleHandler()
        });

console.log("RESULT", JSON.stringify(result, null, 4));

        ASSERT.deepEqual(JSON.parse(JSON.stringify(result)), {
            "#": "Transaction",
            "instance": {
                "#": "EntityModel",
                "adapters": {
                    "@servers": {
                        "#": "EntityAdapter",
                        "handlers": {
                            "#": "Handler"
                        }
                    }
                }
            },
            "status": "done",
            "changes": [
                {
                    "action": "create",
                    "name": "server-1",
                    "config": {
                        "name": "server-1"
                    },
                    "entity": "@servers",
                    "mountPropertyPath": [
                        "@servers",
                        "server-1"
                    ]
                },
                {
                    "action": "create",
                    "name": "server-2",
                    "config": {
                        "name": "server-2",
                        "cluster": {
                            "nodes": {}
                        }
                    },
                    "entity": "@servers",
                    "mountPropertyPath": [
                        "@servers",
                        "server-2"
                    ]
                }
            ],
            "configBefore": {},
            "configAfter": {
                "@servers": {
                    "server-1": {
                        "name": "server-1"
                    },
                    "server-2": {
                        "name": "server-2",
                        "cluster": {
                            "nodes": {}
                        }
                    }
                }
            }
        });
    });
*/

});
