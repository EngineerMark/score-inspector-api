const express = require('express');
const { VerifyToken, getFullUsers, GetInspectorUser } = require('../../helpers/inspector');
const { InspectorClanMember, InspectorClan, InspectorClanStats } = require('../../helpers/db');
const { Op } = require('sequelize');
const { UpdateClan, IsUserClanOwner } = require('../../helpers/clans');
const { includes } = require('lodash');
const router = express.Router();
require('dotenv').config();

const stat_rankings = [
    { key: 'clears', query: 'clears' },
    { key: 'total_ss', query: 'total_ssh+total_ss' },
    { key: 'total_s', query: 'total_sh+total_s' },
    { key: 'total_a', query: 'total_a' },
    { key: 'total_b', query: 'total_b' },
    { key: 'total_c', query: 'total_c' },
    { key: 'total_d', query: 'total_d' },
    { key: 'playcount', query: 'playcount' },
    { key: 'playtime', query: 'playtime' },
    { key: 'ranked_score', query: 'ranked_score' },
    { key: 'total_score', query: 'total_score' },
    { key: 'replays_watched', query: 'replays_watched' },
    { key: 'total_hits', query: 'total_hits' },
    { key: 'average_pp', query: 'average_pp' },
    { key: 'total_pp', query: 'total_pp' },
    { key: 'accuracy', query: 'accuracy' }
]

router.get('/list', async (req, res, next) => {
    const order = req.query.order || 'average_pp';
    const clans = await InspectorClan.findAll({
        include: [
            {
                model: InspectorClanStats,
                as: 'clan_stats',
            },
            {
                model: InspectorClanMember,
                as: 'clan_members',
                where: {
                    pending: false
                }
            }
        ],
    });

    res.json({ clans: clans });
});

router.post('/create', async (req, res, next) => {
    //console.log(req.body);

    //first we check osu_id and token, to see if the user is valid
    const user_id = req.body.user.id;
    const token = req.body.user.token;

    if (VerifyToken(token, user_id) === false) {
        res.json({ error: "Invalid token" });
        return;
    }

    //then we check if the user is already in a clan
    //if they are, we return an error

    const user_clan = await InspectorClanMember.findOne({
        where: {
            osu_id: user_id
        }
    });

    if (user_clan) {
        res.json({ error: "User is already in a clan" });
        return;
    }

    //then we check if the clan name or tag is already taken
    //if they are, we return an error

    const clan_name = req.body.name;
    const clan_tag = req.body.tag;

    const clan_name_taken = await InspectorClan.findOne({
        where: {
            [Op.or]: [
                { name: clan_name },
                { tag: clan_tag }
            ]
        }
    });

    if (clan_name_taken) {
        res.json({ error: "Clan name or tag is already taken" });
        return;
    }

    //if everything is good, we create the clan
    //we also add the user to the clan

    const new_clan = await InspectorClan.create({
        name: clan_name,
        tag: clan_tag,
        owner: user_id,
        description: req.body.description,
        color: req.body.color,
        creation_date: new Date()
    });

    const new_member = await InspectorClanMember.create({
        clan_id: new_clan.id,
        osu_id: user_id,
        pending: false,
        join_date: new Date()
    });

    const new_stats = await InspectorClanStats.create({
        clan_id: new_clan.id
    });

    await UpdateClan(new_clan.id);

    res.json({ clan: new_clan, member: new_member, stats: new_stats });
});

router.all('/get/:id', async (req, res, next) => {
    const login_user_id = req.body.login_user_id;
    const login_token = req.body.login_user_token;
    let allow_pending = false;

    if (login_user_id && login_token) {
        if (VerifyToken(login_token, login_user_id)) {
            allow_pending = true;
        }
    }

    const clan_id = req.params.id;
    const clan = await InspectorClan.findOne({
        where: {
            id: clan_id
        }
    });

    if (!clan) {
        res.json({ error: "Clan not found" });
        return;
    }

    const members = await InspectorClanMember.findAll({
        where: {
            clan_id: clan_id,
            pending: allow_pending ? { [Op.or]: [true, false] } : false
        }
    });

    //get full user info for each member
    const ids = members.map(m => m.osu_id);
    const full_users = await getFullUsers(ids, { daily: true, alt: false, score: false, osu: false });

    let _members = [];

    members.forEach(m => {
        const user = full_users.find(u => u.osu.id == m.osu_id);
        _members.push({
            user: user,
            join_date: m.join_date,
            pending: m.pending
        });
    });

    const pending_members = _members.filter(m => m.pending == true);
    const full_members = _members.filter(m => m.pending == false);

    console.log(full_members);
    console.log(pending_members);

    const owner = full_members.find(m => m.user?.osu?.id == clan.owner) || null;

    const stats = await InspectorClanStats.findOne({
        where: {
            clan_id: clan_id
        }
    });

    //for each statistic except "clan_id", check clan position based on sorting
    const stats_keys = Object.keys(stats.dataValues);
    stats_keys.splice(stats_keys.indexOf('clan_id'), 1);

    const rankings = {};

    for (const rank of stat_rankings) {
        const sorted = await InspectorClanStats.findAll({
            order: [[rank.key, 'DESC']]
        });

        const index = sorted.findIndex(s => s.clan_id == clan_id);
        rankings[rank.key] = index + 1;
    }

    console.log(full_members);

    res.json({ clan: clan, stats: stats, members: full_members, owner: owner, ranking: rankings, pending_members: pending_members });
});

router.post('/update', async (req, res, next) => {
    const user_id = req.body.user.id;
    const token = req.body.user.token;

    if (VerifyToken(token, user_id) === false) {
        res.json({ error: "Invalid token" });
        return;
    }

    const clan_id = req.body.id;
    const clan = await InspectorClan.findOne({
        where: {
            id: clan_id
        }
    });

    if (!clan) {
        res.json({ error: "Clan not found" });
        return;
    }

    if (clan.owner != user_id) {
        res.json({ error: "You are not the owner of this clan" });
        return;
    }

    //validate header image url
    const header_image_url = req.body.header_image_url;
    if (header_image_url && header_image_url.length > 0) {
        try {
            const url = new URL(header_image_url);
            if (url.protocol != "http:" && url.protocol != "https:") {
                res.json({ error: "Invalid header image url" });
                return;
            }

            //check image validity, with content-disposition:inline
            const response = await fetch(url.href, {
                method: 'HEAD'
            });

            if (response.status != 200) {
                res.json({ error: "Invalid header image url" });
                return;
            }

            //check mime type
            const content_type = response.headers.get('content-type');
            if (!content_type.startsWith("image/")) {
                res.json({ error: "Invalid header image url" });
                return;
            }

        } catch (err) {
            res.json({ error: err.message });
            return;
        }
    }

    const new_data = {
        name: req.body.name,
        tag: req.body.tag,
        description: req.body.description,
        color: req.body.color,
        header_image_url: req.body.header_image_url
    };

    for (const key in new_data) {
        clan[key] = new_data[key];
    }

    await clan.save();
    
    await UpdateClan(clan_id);

    res.json({ clan: clan });
});

router.post('/delete', async (req, res, next) => {
    const user_id = req.body.user.id;
    const token = req.body.user.token;

    if (VerifyToken(token, user_id) === false) {
        res.json({ error: "Invalid token" });
        return;
    }

    const clan_id = req.body.id;
    const clan = await InspectorClan.findOne({
        where: {
            id: clan_id
        }
    });

    if (!clan) {
        res.json({ error: "Clan not found" });
        return;
    }

    if (clan.owner != user_id) {
        res.json({ error: "You are not the owner of this clan" });
        return;
    }

    //delete all members
    await InspectorClanMember.destroy({
        where: {
            clan_id: clan_id
        }
    });

    //delete all stats
    await InspectorClanStats.destroy({
        where: {
            clan_id: clan_id
        }
    });

    await clan.destroy();

    res.json({ success: true });
});

router.post('/join_request', async (req, res, next) => {
    const user_id = req.body.user_id;
    const token = req.body.token;
    const clan_id = req.body.clan_id;

    if (VerifyToken(token, user_id) === false) {
        res.json({ error: "Invalid token" });
        return;
    }

    const user = await GetInspectorUser(user_id);
    if (!user) {
        res.json({ error: "User not found" });
        return;
    }

    if (user.clan_member) {
        res.json({ error: `You are already in a clan or have a request to a clan: ${user.clan_member.clan.name}` });
        return;
    }

    const clan = await InspectorClan.findOne({
        where: {
            id: clan_id
        }
    });

    if (!clan) {
        res.json({ error: "Clan not found" });
        return;
    }

    await InspectorClanMember.create({
        osu_id: user_id,
        clan_id: clan_id,
        pending: true,
        join_date: new Date()
    });

    res.json({ success: true });
});

router.post('/accept_request', async (req, res, next) => {
    const owner_id = req.body.owner_id;
    const token = req.body.token;
    const user_id = req.body.join_request_id;
    const clan_id = req.body.clan_id;

    if (VerifyToken(token, owner_id) === false) {
        res.json({ error: "Invalid token" });
        return;
    }

    if(!IsUserClanOwner(owner_id, clan_id)){
        res.json({ error: "You are not the owner of this clan" });
        return;
    }

    const user = await GetInspectorUser(user_id);
    if (!user) {
        res.json({ error: "User not found" });
        return;
    }

    const clan = await InspectorClan.findOne({
        where: {
            id: clan_id
        }
    });

    if (!clan) {
        res.json({ error: "Clan not found" });
        return;
    }

    const member = await InspectorClanMember.findOne({
        where: {
            osu_id: user_id,
            clan_id: clan_id,
            pending: true
        }
    });

    if (!member) {
        res.json({ error: "User is not pending to join this clan" });
        return;
    }

    member.pending = false;
    member.join_date = new Date();

    await member.save();

    await UpdateClan(clan_id);

    res.json({ success: true });
});

router.post('/reject_request', async (req, res, next) => {
    const owner_id = req.body.owner_id;
    const token = req.body.token;
    const user_id = req.body.join_request_id;
    const clan_id = req.body.clan_id;

    if (VerifyToken(token, owner_id) === false) {
        res.json({ error: "Invalid token" });
        return;
    }

    if(!IsUserClanOwner(owner_id, clan_id)){
        res.json({ error: "You are not the owner of this clan" });
        return;
    }

    const user = await GetInspectorUser(user_id);
    if (!user) {
        res.json({ error: "User not found" });
        return;
    }

    const clan = await InspectorClan.findOne({
        where: {
            id: clan_id
        }
    });

    if (!clan) {
        res.json({ error: "Clan not found" });
        return;
    }

    const member = await InspectorClanMember.findOne({
        where: {
            osu_id: user_id,
            clan_id: clan_id,
            pending: true
        }
    });

    if (!member) {
        res.json({ error: "User is not pending to join this clan" });
        return;
    }

    await member.destroy();

    res.json({ success: true });
});

router.post('/remove_member', async (req, res, next) => {
    const owner_id = req.body.owner_id;
    const token = req.body.token;
    const user_id = req.body.member_id;
    const clan_id = req.body.clan_id;

    if (VerifyToken(token, owner_id) === false) {
        res.json({ error: "Invalid token" });
        return;
    }

    if(!IsUserClanOwner(owner_id, clan_id)){
        res.json({ error: "You are not the owner of this clan" });
        return;
    }

    const user = await GetInspectorUser(user_id);
    if (!user) {
        res.json({ error: "User not found" });
        return;
    }

    const clan = await InspectorClan.findOne({
        where: {
            id: clan_id
        }
    });

    if (!clan) {
        res.json({ error: "Clan not found" });
        return;
    }

    const member = await InspectorClanMember.findOne({
        where: {
            osu_id: user_id,
            clan_id: clan_id
        }
    });

    if (!member) {
        res.json({ error: "User is not in this clan" });
        return;
    }

    await member.destroy();

    await UpdateClan(clan_id);

    res.json({ success: true });
});

router.post('/leave', async (req, res, next) => {
    const user_id = req.body.user_id;
    const token = req.body.token;
    const clan_id = req.body.clan_id;

    if (VerifyToken(token, user_id) === false) {
        res.json({ error: "Invalid token" });
        return;
    }

    if(IsUserClanOwner(user_id, clan_id)){
        res.json({ error: "You cannot leave a clan you own" });
        return;
    }

    const user = await GetInspectorUser(user_id);
    if (!user) {
        res.json({ error: "User not found" });
        return;
    }

    if (!user.clan_member) {
        res.json({ error: "User is not in a clan" });
        return;
    }

    if (user.clan_member.clan_id != clan_id) {
        res.json({ error: "User is not in this clan" });
        return;
    }

    await user.clan_member.destroy();

    await UpdateClan(clan_id);

    res.json({ success: true });
});

module.exports = router;