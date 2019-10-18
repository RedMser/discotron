const GuildModel = require("./../../models/guild.js");
const UserRole = require("./user-role.js");
const Permission = require("./permission.js");
const webAPI = require("./../apis/web-api.js").getWebAPI("discotron-dashboard");
const Plugin = require("./plugin.js");
const db = require("./../apis/database-crud.js");
const Logger = require("../utils/logger.js")
/**
 * Discotron guild containing info related to a Discord guild
 */
class Guild extends GuildModel {
    /**
     * @constructor
     * @param {string} discordId Discord guild id
     */
    constructor(discordId) {
        super(discordId);

        global.discotron.on("plugin-loaded", (pluginId) => {
            this.onPluginLoaded(pluginId);
        });

        global.discotron.on("plugin-deleted", (pluginId) => {
            this.onPluginDeleted(pluginId);
        });

        this._loadPrefix();
        this._loadAdminsFromDatabase();
        this._loadAllowedChannels();
        this._loadEnabledPlugins();

        Guild._guilds[discordId] = this;
    }

    /**
     * @static
     * @param {string} discordId Discord guild id
     * @returns Discotron guild with the given discord guild id
     */
    static get(discordId) {
        return Guild._guilds[discordId];
    }

    /**
     * @static
     * @returns {array} Array of Guild
     */
    static getAll() {
        return Guild._guilds;
    }

    /**
     * @returns {object} Object containing {id, prefix, name, nameAcronym, image, allowedChannelIds, enabledPluginIds, admins, permissions}
     */
    toObject() {
        let guild = global.discordClient.guilds.get(this.discordId);
        let permissions = {};
        for (const pluginId in this.permissions) {
            const permission = this.permissions[pluginId];
            permissions[pluginId] = permission.toObject();
        }
        return {
            id: this.discordId,
            prefix: this.commandPrefix,
            name: guild.name,
            nameAcronym: guild.nameAcronym,
            image: guild.iconURL,
            allowedChannelIds: Array.from(this.allowedChannelIds),
            enabledPluginIds: Array.from(this.enabledPlugins),
            admins: Array.from(this._admins).map((userRole) => {
                return userRole.toObject();
            }),
            permissions: permissions
        };
    }

    /**
     * @param {string} discordUserId Discord user id
     * @returns Whether the given user id is a bot admin on the guild
     */
    isAdmin(discordUserId) {
        let isadmin = false;
        this._admins.forEach((admin) => {
            if (admin.describes(discordUserId)) {
                isadmin = true;
                return false;
            }
        });
        this._discordAdmins.forEach((admin) => {
            if (admin.describes(discordUserId)) {
                isadmin = true;
                return false;
            }
        });
        return isadmin;
    }

    /**
     * @static
     * @param {string} discordUserId Discord user id
     * @param {string} discordGuildId Discord gulid id
     * @returns {boolean} True if the user is bot admin on the guild
     */
    static isGuildAdmin(discordUserId, discordGuildId) {
        return Guild.get(discordGuildId).isAdmin(discordUserId);
    }

    /**
     * Adds a bot admin to the guild
     * @param {array} usersRoles Array of UserRole 
     */
    set admins(usersRoles) {
        // Note : the users / roles we receive come from the dashboard, and as such do not have the discordGuildId attribute set
        usersRoles = usersRoles.map((ur) => {
            return new UserRole(ur._discordUserId, ur._discordRoleId, this.discordId);
        });

        this._admins = new Set(usersRoles);

        db.delete("Admins", {
            discordGuildId: this.discordId
        }).then(() => {
            let promises = [];

            for (let i = 0; i < usersRoles.length; ++i) {
                const userRole = usersRoles[i];
                // TODO: Do only one query, update without deleting everything
                promises.push(userRole.getId().then((id) => {
                    return db.insert("Admins", {
                        discordGuildId: this.discordId,
                        userRoleId: id
                    });
                }));
            }

            return Promise.all(promises);
        }).catch(Logger.err);
    }

    /**
     * @returns {array} List of admins for this guild
     */
    get admins() {
        return super.admins;
    }

    /**
     * Load guild admins from Discord
     */
    loadDiscordAdmins() {
        // TODO: Refresh that when it changes on Discord
        this._discordAdmins = new Set([]);

        let guild = global.discordClient.guilds.get(this.discordId);
        let admin = new UserRole(guild.ownerID, null, this.discordId);
        this._discordAdmins.add(admin);

        let roles = guild.roles.array();
        for (let i = 0; i < roles.length; ++i) {
            const role = roles[i];
            if (role.hasPermission("ADMINISTRATOR")) {
                let userRole = new UserRole(null, role.id, this.discordId);
                this._discordAdmins.add(userRole);
            }
        }
    }


    /**
     * Set bot prefix for a guild, save it in the database
     * @param {string} prefix 
     */
    set commandPrefix(prefix) {
        this._commandPrefix = prefix;
        db.update("GuildSettings", {
            prefix: prefix
        }, {
            discordGuildId: this.discordId
        }).catch(Logger.err);
    }

    /**
     * @returns {string} Command prefix
     */
    get commandPrefix() {
        return super.commandPrefix;
    }

    /**
     * Set allowed channels
     * @param {array} discordChannelIds List of Discord channel ids
     */
    set allowedChannelIds(discordChannelIds) {
        this._allowedChannelIds = new Set(discordChannelIds);

        db.delete("AllowedChannels", {
            discordGuildId: this.discordId
        }).then(() => {
            for (let i = 0; i < discordChannelIds.length; ++i) {
                return db.insert("AllowedChannels", {
                    discordGuildId: this.discordId,
                    discordChannelId: discordChannelIds[i]
                });
            }
        }).catch(Logger.err);
    }

    /**
     * @returns {array} List of Discord channel ids
     */
    get allowedChannelIds() {
        return super.allowedChannelIds;
    }

    /**
     * @param {string} pluginId ID of the plugin
     * @returns {boolean} True if the plugin is enabled in the guild
     */
    isPluginEnabled(pluginId) {
        return this.enabledPlugins.has(pluginId);
    }

    /**
     * Set whether the given plugin is enabled on the guild
     * @param {string} pluginId 
     * @param {boolean} enabled 
     */
    setPluginEnabled(pluginId, enabled) {
        if (this._enabledPlugins.size === 0) {
            if (!enabled) {
                for (let pluginId_ in Plugin.getAll()) {
                    if (pluginId !== pluginId_) {
                        this._enabledPlugins.add(pluginId_);
                    }
                }
            } else {
                // should not happen
            }
        } else {
            if (enabled) {
                this._enabledPlugins.add(pluginId);
            } else {
                this._enabledPlugins.delete(pluginId);
            }
        }

        db.delete("GuildEnabledPlugins", {
            discordGuildId: this.discordId
        }).then(() => {
            let promises = [];
            this._enabledPlugins.forEach((element) => {
                promises.push(db.insert("GuildEnabledPlugins", {
                    pluginId: element,
                    discordGuildId: this.discordId
                }));
            });
            return Promise.all(promises);
        }).catch(Logger.err);
    }

    /**
     * Set the set of users and roles allowed to use the given plugin
     * @param {string} pluginId 
     * @param {array} userRoles 
     */
    setPluginPermission(pluginId, userRoles) {
        this._permissions[pluginId]._usersRoles = userRoles;

        // TODO: Do only one query, do not delete to update everything one by one
        db.delete("Permissions", {
            discordGuildId: this.discordId,
            pluginId: pluginId
        }).then(() => {
            let promises = [];
            for (let i = 0; i < userRoles.length; ++i) {
                promises.push(userRoles[i].getId().then((id) => {
                    return db.insert("Permissions", {
                        discordGuildId: this.discordId,
                        pluginId: pluginId,
                        userRoleId: id
                    });
                }));
            }
            return Promise.all(promises);
        }).catch(Logger.err);
    }

    /**
     * Must be called after a plugin is loaded
     * @param {string} pluginId that was loaded
     */
    onPluginLoaded(pluginId) {
        this._loadPluginPermission(pluginId);
    }

    /**
     * Must be before a plugin is deleted
     * @param {string} pluginId 
     */
    onPluginDeleted(pluginId) {
        delete this.permissions[pluginId];
        this._enabledPlugins.delete(pluginId);
    }

    /**
     * Load plugin permissions from database
     * @param {string} pluginId 
     */
    _loadPluginPermission(pluginId) {
        this._permissions[pluginId] = new Permission(this.discordId, pluginId, []);
        // TODO: Fix n + 1 query here
        db.select("Permissions", ["userRoleId"], {
            discordGuildId: this.discordId,
            pluginId: pluginId
        }).then((rows) => {
            let promises = [];
            const pluginPermission = this._permissions[pluginId];

            for (let i = 0; i < rows.length; ++i) {
                promises.push(UserRole.getById(rows[i].userRoleId, this.discordId).then((userRole) => {
                    pluginPermission._usersRoles.push(userRole);
                }));
            }

            return Promise.all(promises);
        }).catch(Logger.err);
    }

    /**
     * Load plugins enabled on this guild from database
     */
    _loadEnabledPlugins() {
        db.select("GuildEnabledPlugins", ["pluginId"], {
            discordGuildId: this.discordId
        }).then((rows) => {
            for (let i = 0; i < rows.length; ++i) {
                this._enabledPlugins.add(rows[i].pluginId);
            }
        }).catch(Logger.err);
    }

    /**
     * Load allowed channels from database
     */
    _loadAllowedChannels() {
        db.select("AllowedChannels", ["discordChannelId"], {
            discordGuildId: this.discordId
        }).then((rows) => {
            for (let i = 0; i < rows.length; ++i) {
                this._allowedChannelIds.add(rows[i].discordChannelId);
            }
        }).catch(Logger.err);
    }

    /**
     * Load prefix from database, insert default value in db if none found
     */
    _loadPrefix() {
        db.select("GuildSettings", ["prefix"], {
            discordGuildId: this.discordId
        }).then((rows) => {
            if (rows.length > 0) {
                this._commandPrefix = rows[0].prefix;
            } else {
                return db.insert("GuildSettings", {
                    discordGuildId: this.discordId,
                    prefix: "!"
                });
            }
        }).catch(Logger.err);

    }

    /**
     * Loads admins from db, inserts default values if none found
     */
    _loadAdminsFromDatabase() {
        // TODO: Fix n + 1 query here
        db.select("Admins", ["userRoleId"], {
            discordGuildId: this.discordId
        }).then((rows) => {
            let promises = [];
            for (let i = 0; i < rows.length; ++i) {
                promises.push(UserRole.getById(rows[i].userRoleId, this.discordId).then((userRole) => {
                    this._admins.add(userRole);
                }));
            }
            return Promise.all(promises);
        }).catch(Logger.err);
    }

    /**
     * Removes the guild from the database
     */
    delete() {
        Promise.all([
            db.delete("Admins", {
                discordGuildId: this.discordId
            }),
            db.delete("AllowedChannels", {
                discordGuildId: this.discordId
            }),
            db.delete("GuildSettings", {
                discordGuildId: this.discordId
            }),
            db.delete("GuildEnabledPlugins", {
                discordGuildId: this.discordId
            }),
            db.delete("Permissions", {
                discordGuildId: this.discordId
            })
        ]).catch(Logger.err).then(() => {
            delete Guild._guilds[this.discordId];
        });
    }

    /**
     * Register WebAPI actions related to a guild
     * @static
     */
    static registerActions() {
        webAPI.registerAction("get-guilds", (data, reply, discordUserId, discordGuildId) => {
            let guilds = {};
            for (const discordGuildId in Guild.getAll()) {
                guilds[discordGuildId] = Guild.get(discordGuildId).toObject();
            }
            reply(guilds);
        }, "guildAdmin");

        webAPI.registerAction("get-members", (data, reply, discordUserId, discordGuildId) => {
            let guild = global.discordClient.guilds.get(discordGuildId);
            let members = guild.members;
            reply(members.map(member => {
                return {
                    id: member.user.id,
                    name: member.user.username,
                    discriminator: member.user.discriminator,
                    avatar: member.user.displayAvatarURL
                };
            }));
        }, "guildAdmin");

        webAPI.registerAction("get-roles", (data, reply, discordUserId, discordGuildId) => {
            let guild = global.discordClient.guilds.get(discordGuildId);
            reply(guild.roles.map((role) => {
                return {
                    id: role.id,
                    name: role.name,
                    color: role.hexColor
                };
            }));
        }, "guildAdmin");

        webAPI.registerAction("get-channels", (data, reply, discordUserId, discordGuildId) => {
            let guild = global.discordClient.guilds.get(discordGuildId);
            reply(guild.channels.map((channel) => {
                return {
                    id: channel.id,
                    name: channel.name,
                    type: channel.type
                };
            }));
        }, "guildAdmin");

        webAPI.registerAction("get-guilds-where-is-admin", (data, reply, discordUserId) => {
            let guilds = [];
            for (const discordGuildId in Guild._guilds) {
                const guild = Guild.get(discordGuildId);
                if (guild.isAdmin(discordUserId)) {
                    guilds.push(guild.toObject());
                }
            }
            reply(guilds);
        });

        webAPI.registerAction("get-allowed-channels", (data, reply, discordUserId, discordGuildId) => {
            reply(Guild.get(discordGuildId).allowedChannelIds);
        }, "guildAdmin");

        webAPI.registerAction("set-allowed-channels", (data, reply, discordUserId, discordGuildId) => {
            Guild.get(discordGuildId).allowedChannelIds = data.allowedChannelIds;
            reply();
        }, "guildAdmin");

        webAPI.registerAction("get-plugin-enabled", (data, reply, discordUserId, discordGuildId) => {
            reply(Guild.get(discordGuildId).isPluginEnabled(data.pluginId));
        }, "guildAdmin");

        webAPI.registerAction("set-plugin-enabled", (data, reply, discordUserId, discordGuildId) => {
            Guild.get(discordGuildId).setPluginEnabled(data.pluginId, data.enabled);
            reply();
        }, "guildAdmin");

        webAPI.registerAction("get-plugin-permission", (data, reply, discordUserId, discordGuildId) => {
            reply(Guild.get(discordGuildId).permissions[data.pluginId].toObject());
        }, "guildAdmin");

        webAPI.registerAction("set-plugin-permission", (data, reply, discordUserId, discordGuildId) => {
            let usersRoles = data.userRoles.map((ur) => {
                return new UserRole(ur._discordUserId, ur._discordRoleId, discordGuildId);
            });
            Guild.get(discordGuildId).setPluginPermission(data.pluginId, usersRoles);
            reply();
        }, "guildAdmin");

        webAPI.registerAction("get-guild-prefix", (data, reply, discordUserId, discordGuildId) => {
            reply(Guild.get(discordGuildId).commandPrefix);
        }, "guildAdmin");

        webAPI.registerAction("set-guild-prefix", (data, reply, discordUserId, discordGuildId) => {
            Guild.get(discordGuildId).commandPrefix = data.prefix;
            reply();
        }, "guildAdmin");

        webAPI.registerAction("get-admins", (data, reply, discordUserId, discordGuildId) => {
            reply(Array.from(Guild.get(discordGuildId).admins));
        }, "guildAdmin");

        webAPI.registerAction("set-admins", (data, reply, discordUserId, discordGuildId) => {
            Guild.get(discordGuildId).admins = data.admins;
            reply();
        }, "guildAdmin");
    }
}

Guild._guilds = {};

module.exports = Guild;