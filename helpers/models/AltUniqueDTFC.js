const { Sequelize } = require("sequelize");

const AltUniqueDTFCModel = (db) => db.define('UniqueDTFC', {
    beatmap_id: { type: Sequelize.INTEGER, primaryKey: true, autoIncrement: true, },
    user_id: { type: Sequelize.INTEGER },
}, {
    tableName: 'unique_dt_fc',
    timestamps: false,
});
module.exports.AltUniqueDTFCModel = AltUniqueDTFCModel;