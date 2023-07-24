var express = require('express');
var apicache = require('apicache');
var router = express.Router();
const { Client } = require('pg');
const { GetBestScores, score_columns, score_columns_full, beatmap_columns, GetBeatmapScores } = require('../helpers/osualt');
const rateLimit = require('express-rate-limit');
const { getBeatmaps, getCompletionData } = require('../helpers/inspector');
const { AltScore, AltBeatmap, AltModdedStars, AltBeatmapPack, InspectorModdedStars, InspectorScoreStat, AltBeatmapEyup, Databases, AltBeatmapSSRatio, AltTopScore } = require('../helpers/db');
const { Op, Sequelize } = require('sequelize');
const { CorrectedSqlScoreMods, CorrectMod, ModsToString, db_now } = require('../helpers/misc');
const { GetCountryLeaderboard } = require('../helpers/osu');
require('dotenv').config();

const limiter = rateLimit({
    windowMs: 60 * 1000, // 15 minutes
    max: 60, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
    standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
    legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

let cache = apicache.middleware;

async function GetUserScores(req, score_attributes = undefined, beatmap_attributes = undefined) {
    const include_modded = req.query.ignore_modded_stars !== 'true';
    let scores = await AltScore.findAll({
        attributes: score_attributes,
        where: {
            user_id: req.params.id
        },
        order: [
            [req.query.order ?? 'pp', req.query.dir ?? 'DESC']
        ],
        limit: req.query.limit ?? undefined,
        include: [
            {
                attributes: beatmap_attributes,
                model: AltBeatmap,
                as: 'beatmap',
                where: {
                    approved: { [Op.in]: [1, 2, req.query.include_loved === 'true' ? 4 : 1] }
                },
                required: true,
                include: [
                    ...(include_modded ? [
                        {
                            model: AltModdedStars,
                            as: 'modded_sr',
                            where: {
                                mods_enum: {
                                    [Op.eq]: Sequelize.literal(CorrectedSqlScoreMods)
                                },
                                beatmap_id: {
                                    [Op.eq]: Sequelize.literal('beatmap.beatmap_id')
                                }
                            }
                        }] : []),
                    {
                        model: AltBeatmapEyup,
                        as: 'eyup_sr',
                        required: false
                    },
                    {
                        model: AltBeatmapSSRatio,
                        as: 'ss_ratio',
                        required: false
                    },
                    //get all beatmap packs by beatmap_id in one query as an array
                    {
                        model: AltBeatmapPack,
                        as: 'packs',
                        required: false,
                    }
                ],
            },
            {
                model: AltTopScore,
                as: 'top_score',
                where: {
                    user_id: req.params.id
                },
                required: false,
            }
        ],
        nest: true
    });
    console.log('got scores')
    scores = JSON.parse(JSON.stringify(scores));

    console.log(`got ${scores.length} scores`);

    if (include_modded) {
        //const beatmap_mod_pair = scores.map(score => { return { beatmap_id: score.beatmap_id, mods: score.enabled_mods } });
        const beatmap_ids = scores.map(score => score.beatmap_id);
        const per_fetch = 500;
        let modded_stars_cache = {};
        let unique_versions = [];
        for (let i = 0; i < beatmap_ids.length; i += per_fetch) {
            const modded_stars = await InspectorModdedStars.findAll({
                where: {
                    beatmap_id: {
                        [Op.in]: beatmap_ids
                    }
                },
                limit: per_fetch,
                offset: i,
                raw: true,
                nest: true
            });
            modded_stars.forEach(modded_star => {
                if (!unique_versions.includes(modded_star.version)) {
                    unique_versions.push(modded_star.version);
                }
                modded_stars_cache[`${modded_star.beatmap_id}-${modded_star.mods}-${modded_star.version}`] = modded_star;
            });
        }

        console.log('got modded stars')

        for (const score of scores) {
            const int_mods = parseInt(score.enabled_mods);
            const correct_mods = CorrectMod(int_mods);
            unique_versions.forEach(version => {
                if (score.beatmap.modded_sr === undefined) {
                    score.beatmap.modded_sr = {};
                }
                const sr = modded_stars_cache[`${score.beatmap_id}-${correct_mods}-${version}`];
                if (sr) {
                    score.beatmap.modded_sr[version] = sr;
                }
            });
        };

        console.log('added modded stars')
    }

    if (scores && scores.length > 0) {
        //add maxplaycounts
        let beatmap_set_ids = scores.map(score => score.beatmap.set_id);
        let beatmap_ids = scores.map(score => score.beatmap.beatmap_id);
        //remove duplicates and nulls
        beatmap_set_ids = [...new Set(beatmap_set_ids)].filter(id => id);
        beatmap_ids = [...new Set(beatmap_ids)].filter(id => id);
        if (beatmap_set_ids.length > 0 && beatmap_ids.length > 0) {
            const _max_pc = await Databases.osuAlt.query(`
                SELECT set_id, mode, MAX(playcount) AS max_playcount FROM beatmaps
                WHERE set_id IN (${beatmap_set_ids.join(',')})
                GROUP BY set_id, mode
            `);

            let max_pc = _max_pc?.[0];

            console.log('got max playcounts')

            console.time('max pc loop')
            for (const score of scores) {
                const max_pc_beatmap_index = max_pc?.findIndex(b => b.set_id === score.beatmap.set_id && b.mode === score.beatmap.mode);
                const max_pc_beatmap = max_pc?.[max_pc_beatmap_index];

                //remove the index if found
                if (max_pc_beatmap_index !== -1) {
                    max_pc.splice(max_pc_beatmap_index, 1);
                }

                if (max_pc_beatmap && score.beatmap?.eyup_sr) {
                    score.beatmap.eyup_sr.max_playcount = max_pc_beatmap.max_playcount;
                }

                // if (pack_ids_beatmap && pack_ids_beatmap.length > 0) {
                //     score.beatmap.packs = pack_ids_beatmap;
                // }
            }
            console.timeEnd('max pc loop')

            console.log('applied max playcounts and packs')
        } else {
            console.warn(`[Scores] ${scores.length} scores, ${beatmap_ids} set ids found for: ${req.params.id}`);
        }
    }

    console.log(`[Scores] Fetched ${scores.length} scores for user ${req.params.id} (include_loved: ${req.query.include_loved}, ignored modded starrating: ${req.query.ignore_modded_stars === 'true'})`);

    return scores;
}

/* Get the entire list of scores of a user */
router.get('/user/:id', limiter, cache('1 hour'), async function (req, res, next) {
    const rows = await GetUserScores(req);
    res.json(rows);
});

/* Get the entire list of scores of a beatmap */
router.get('/beatmap/:id', limiter, cache('1 hour'), async function (req, res, next) {
    const beatmap_id = req.params.id;
    const limit = req.query.limit ?? undefined;
    const offset = req.query.offset ?? undefined;
    const rows = await GetBeatmapScores(beatmap_id, limit, offset);
    res.json(rows);
});

router.get('/completion/:id', limiter, cache('1 hour'), async function (req, res, next) {
    req.query.ignore_modded_stars = 'true';
    console.time('GetUserScores');
    const scores = await GetUserScores(req, ['beatmap_id'], ['beatmap_id', 'approved_date', 'length', 'stars', 'cs', 'ar', 'od', 'hp', 'approved']);
    console.timeEnd('GetUserScores');

    const beatmaps = await getBeatmaps({
        ...req.query, customAttributeSet: [
            'beatmap_id',
            'cs',
            'ar',
            'od',
            'hp',
            'approved_date',
            'star_rating',
            'total_length'
        ]
    });

    console.time('getCompletionData');
    const data = getCompletionData(scores, beatmaps);
    console.timeEnd('getCompletionData');

    res.json(data);
});

const valid_periods = ['all', 'year', 'month', 'week', 'day'];
const valid_stats = ['pp', 'score'];
router.get('/best', limiter, cache('1 hour'), async function (req, res, next) {
    const period = req.query.period || 'all';
    const stat = req.query.stat || 'pp';
    const limit = req.query.limit || 5;
    const loved = req.query.loved ? true : false;
    if (!valid_periods.includes(period)) {
        res.status(400).json({ "error": "Invalid period" });
        return;
    }
    if (!valid_stats.includes(stat)) {
        res.status(400).json({ "error": "Invalid stat" });
        return;
    }
    if (isNaN(limit) || limit < 1 || limit > 100) {
        res.status(400).json({ "error": "Invalid limit" });
        return;
    }

    let scores;
    try {
        scores = await GetBestScores(period, stat, limit, loved);
    } catch (e) {
        res.status(500).json({ "error": "Error while fetching scores" });
        return;
    }

    res.json(scores);
});

const STAT_PERIODS = [
    '30min', '24h', '7d', 'all'
]

router.get('/stats', limiter, async function (req, res, next) {
    //stats from today
    let data = {};
    for await (const period of STAT_PERIODS) {
        const rows = await InspectorScoreStat.findAll({
            where: {
                period: period
            },
            raw: true,
            nest: true
        });

        data[period] = {};
        rows.forEach(row => {
            try {
                data[period][row.key] = JSON.parse(row.value);
            } catch (e) {
                data[period][row.key] = row.value;
            }
        });
    }

    res.json(data);
});

router.get('/most_played', limiter, cache('1 hour'), async function (req, res, next) {
    const client = new Client({ user: process.env.ALT_DB_USER, host: process.env.ALT_DB_HOST, database: process.env.ALT_DB_DATABASE, password: process.env.ALT_DB_PASSWORD, port: process.env.ALT_DB_PORT });
    await client.connect();

    const limit = req.params.limit || 10;
    const offset = req.params.offset || 0;

    const query = `
        SELECT t.* FROM 
        (
            SELECT count(*), beatmaps.* 
            FROM scores LEFT JOIN beatmaps ON scores.beatmap_id = beatmaps.beatmap_id 
            WHERE (beatmaps.approved = 1 OR beatmaps.approved = 2 OR beatmaps.approved = 4) 
            GROUP BY beatmaps.beatmap_id 
            ORDER BY count(*) DESC
        ) as t 
        LIMIT ${limit} 
        OFFSET ${offset}`;

    const { rows } = await client.query(query);
    await client.end();
    res.json(rows);
});

router.get('/activity', limiter, cache('20 minutes'), async function (req, res, next) {
    const hours = req.query.hours || 24;
    const query = `WITH hour_entries AS (
        SELECT generate_series(date_trunc('hour', ${db_now} - INTERVAL '${hours} hours'), date_trunc('hour', ${db_now}), INTERVAL '1 hour') AS hour
      )
      SELECT ARRAY(
        SELECT json_build_object('timestamp', h.hour, 'entry_count', COALESCE(COUNT(s.date_played), 0)) AS entry
        FROM hour_entries h
        LEFT JOIN scores s ON date_trunc('hour', s.date_played) = h.hour
                           AND s.date_played >= ${db_now} - INTERVAL '${hours} hours'
        GROUP BY h.hour
        ORDER BY h.hour
      ) AS hour_entries;`;

    const client = new Client({ user: process.env.ALT_DB_USER, host: process.env.ALT_DB_HOST, database: process.env.ALT_DB_DATABASE, password: process.env.ALT_DB_PASSWORD, port: process.env.ALT_DB_PORT });
    await client.connect();

    const { rows } = await client.query(query);
    await client.end();
    res.json(rows);
});

module.exports = router;
