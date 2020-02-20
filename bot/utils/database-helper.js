const sqlite = require("sqlite3");
const migrations = require("../utils/database-migrations.js");
const fs = require("fs");
const config = require("../config/config.json");
const databasePath = global.discotronConfigPath + "/" + config.database.saveName;

const Logger = require("../utils/logger.js");

let database;

/**
 * @returns {boolean} True if a database file already exists
 */
module.exports.databaseExists = () => {
    return fs.existsSync(databasePath);
};

/**
 * Delete database
 * I'm not sure why this exists
 */
module.exports.deleteDatabase = () => {
    fs.unlink(databasePath, (err) => {
        if (err) {
            Logger.log("Could not delete database", "error");
        }
    });
};

/**
 * Open sqlite database from its file. If it does not exist, it will be created.
 */
module.exports.openDatabase = () => {
    database = new sqlite.Database(databasePath, sqlite.OPEN_READWRITE | sqlite.OPEN_CREATE, (err) => {
        if (err) {
            Logger.log("Could not open database", "error");
            Logger.log(err, "err");
        }
    });
};

/** 
 * @returns {sqlite.Database} Sqlite database
 */
module.exports.getDatabase = () => {
    return database;
};

/**
 * Run all database migrations so that we reach the requested version.
 * {@link https://github.com/forwards-long-jump/discotron/wiki/Database-migrations|More info on writing migrations.}
 * @param {string|null} version Which version to migrate to. If null, the latest version is chosen.
 * @param {boolean} allowDown If true, allow downgrading database version. Otherwise (default), we throw an error.
 */
module.exports.doDatabaseMigrations = async (version = null, allowDown = false) => {
    // While listDiff already handles this similarly, we need a valid "version" string for the SQL as well
    if (version === null) {
        version = migrations.latestMigration();
    }

    const { exec } = require("../apis/database-crud.js");

    const current = await migrations.current();
    try {
        const { names, type } = migrations.listDiff(current, version);
        for (let name of names) {
            if (type === "down" && allowDown !== true) {
                Logger.err("May not downgrade without allowDown set to true.");
                return;
            } else {
                // Open migration file as module and retrieve the required function
                const migration = require(__dirname + "/../migrations/" + name);
                const func = migration[type];
                if (typeof func === "function") {
                    // Execute in database
                    await exec(func());
                }
            }
        }

        // Write the new current version to the database
        await exec(`INSERT OR REPLACE INTO _Migrations(name, value) VALUES('version', '${version}');`);
    } catch (e) {
        Logger.err(`Error migrating from database version "${current}" to "${version}".
Ensure you run migrations to downgrade the database before removing migration files, or you risk a broken database state.`);
        Logger.err(e);
    }
};
