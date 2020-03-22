/**
 * Helper functions for the database
 */
const databaseHelper = require("./database.js");
const Logger = require("../utils/logger.js");
const utils = require("../utils/utils.js");


/**
 * @param {object} where {fieldName: value, ...}
 * @param {string} [separator=" AND "] Separator between entries
 * @returns {object} text: string in the format "KEY1 = $KEY1 separator KEY2 = $KEY2", objParam: given object with its keys prefixed by $
 */
function generateParameters(where, separator = " AND ") {
    let params = "";
    const objParam = {};

    for (const key in where) {
        let comparison;
        if (where[key] === null) {
            comparison = "IS";
        } else {
            comparison = "=";
        }
        params += key + " " + comparison + " $" + key + separator;
        objParam["$" + key] = where[key];
    }
    return {
        text: params.substr(0, params.length - separator.length),
        objParam: objParam
    };
}

/**
 * Returns the string describing the columns, the string describing the values, and the given object with its keys prefixed by $
 * @param {object} values Format: {field: value}
 * @returns {object} columns: list of columns separated by ",", params: list of params separated by",", data: given object with its keys prefixed by à
 */
function generateValuesForInsert(values) {
    let columns = "(";
    let params = "(";
    const data = {};

    for (const key in values) {
        columns += key + ",";
        params += "$" + key + ",";
        data["$" + key] = values[key];
    }

    return {
        columns: columns.substr(0, columns.length - 1) + ")",
        params: params.substr(0, params.length - 1) + ")",
        data: data
    };
}

/**
 * Update entries in the database
 * @param {string} table Table name
 * @param {object} values New values, {fieldName: value, ...}
 * @param {object} where Where to update, {fieldName: value, ...} 
 * @returns {Promise} resolve(), reject(error {string})
 */
module.exports.update = (table, values, where) => {
    const database = databaseHelper.getDatabase();

    return new Promise((resolve, reject) => {
        let sql = "UPDATE " + table + " SET ";
        let valuesText = "";
        const params = [];

        for (const key in values) {
            valuesText += key + "=?,";
            params.push(values[key]);
        }

        valuesText = valuesText.substr(0, valuesText.length - 1);

        let whereText = "";

        for (const key in where) {
            whereText += key + "=? AND ";
            params.push(where[key]);
        }

        whereText = whereText.substr(0, whereText.length - 5);

        sql += valuesText + " WHERE " + whereText;

        database.run(sql, params, (err) => {
            if (err) {
                Logger.err("Update in database failed : " + sql, err);
                reject(err);
            } else {
                resolve();
            }
        });
    });
};

/**
 * Insert one entry in the database
 * @param {string} table Table name
 * @param {object} values New values, {fieldName: value, ...} 
 * @returns {Promise} resolve(), reject(error {string})
 */
module.exports.insert = (table, values) => {
    const database = databaseHelper.getDatabase();

    return new Promise((resolve, reject) => {
        let sql = "INSERT INTO " + table;
        const parameters = generateValuesForInsert(values);
        sql += " " + parameters.columns + " VALUES " + parameters.params;

        database.run(sql, parameters.data, (err) => {
            if (err) {
                Logger.err("Insert in database failed : " + sql, err);
                reject(err);
            } else {
                resolve();
            }
        });
    });
};

/**
 * Delete entries from the database
 * @param {string} table Table names
 * @param {object} where Where to delete, {fieldName: value, ...} 
 * @param {boolean} [eraseAll=false] Set it to true to allow using an empty object for where
 * @returns {Promise} resolve(), reject(error {string})
 */
module.exports.delete = (table, where, eraseAll = false) => {
    const database = databaseHelper.getDatabase();

    return new Promise((resolve, reject) => {
        let sql = "DELETE FROM " + table;

        if (!utils.isEmpty(where)) {
            const parameters = generateParameters(where);
            sql += " WHERE " + parameters.text;

            database.run(sql, parameters.objParam, (err) => {
                if (err) {
                    Logger.err("Delete in database failed : " + sql, err);
                    reject(err);
                } else {
                    resolve();
                }
            });
        } else if (eraseAll === true) {
            database.run(sql, (err) => {
                if (err) {
                    Logger.err("Delete in database failed : " + sql, err);
                    reject(err);
                } else {
                    resolve();
                }
            });
        }
    });
};

/**
 * Select entries from a table
 * @param {string} table Name of the table
 * @param {Array} fields Fields to retrieve
 * @param {object} where Which values to retrieve, {fieldName: value, ...} 
 * @returns {Promise} resolve(rows {array}) rows: Contains {fieldName: value} objects, reject(error {string})
 */
module.exports.select = (table, fields = [], where = {}) => {
    const database = databaseHelper.getDatabase();

    return new Promise((resolve, reject) => {
        let sql = "SELECT ";

        if (fields.length === 0) {
            sql += "*";
        } else {
            sql += fields.join(",");
        }

        sql += " FROM " + table + " ";

        if (!utils.isEmpty(where)) {
            const parameters = generateParameters(where);
            sql += "WHERE " + parameters.text;

            database.all(sql, parameters.objParam, (err, rows) => {
                if (err) {
                    Logger.err("Select in database failed : " + sql);
                    reject(err);
                }
                resolve(rows);
            });
        } else {
            database.all(sql, (err, rows) => {
                if (err) {
                    Logger.err("Select in database failed : " + sql);
                    reject(err);
                }
                resolve(rows);
            });
        }
    });
};

/**
 * Executes one or more raw SQL statements.
 *
 * @param {string} statements A (multi-line) string containing the SQL statements to execute.
 *  SQL comments are not allowed and will throw an error.
 *  It may be worth considering the use of transactions, to ensure that any errors will rollback all changes.
 * @returns {Promise<void>} A promise that resolves when all statements executed without error.
 */
module.exports.exec = (statements) => {
    const database = databaseHelper.getDatabase();

    return new Promise((resolve, reject) => {
        database.exec(statements, (err) => {
            if (err) {
                Logger.err("Exec in database failed : " + statements);
                reject(err);
            }
            resolve();
        });
    });
};
