const express = require('express');
var apicache = require('apicache');
const { GetUser: GetOsuUser, GetDailyUser, GetUsers } = require('../helpers/osu');
const { IsRegistered, GetAllUsers, GetUser: GetAltUser, FindUser } = require('../helpers/osualt');
const rateLimit = require('express-rate-limit');

let cache = apicache.middleware;
const router = express.Router();

const limiter = rateLimit({
	windowMs: 60 * 1000, // 15 minutes
	max: 200, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
	standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
	legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

router.get('/osu/id/:id', limiter, cache('1 hour'),  async (req, res) => {
  const mode = req.query.mode !== undefined ? req.query.mode : 0;
  let user = null;
  try {
    user = await GetOsuUser(req.params.id, 'osu', 'id');
  } catch (err) {
    try {
      user = await GetOsuUser(req.params.id, 'osu', 'username');
    } catch (_err) {
      res.json({ error: 'Unable to get user', message: err.message });
    }
  }
  if (user !== null) {
    res.json(user);
  }
  // res.json(user);
});

router.get('/osu/ids', limiter, cache('1 hour'),  async (req, res) => {
  const ids = req.query.id;
  const mode = req.query.mode !== undefined ? req.query.mode : 0;
  let data;
  try{
    data = await GetUsers(ids);
  }catch(err){
    res.json({error: 'Unable to get users'});
    return;
  }

  let end_data = [];
  ids.forEach(id => {
    let user = data?.users.find(user => user.id == id);
    if(user){
      end_data.push(user);
    }else{
      end_data.push({
        id: id,
        error: 'Unable to get user'
      });
    }
  });

  res.json(end_data)
});

router.get('/daily/:id', limiter, cache('30 minutes'), async (req, res) => {
  const mode = req.query.mode !== undefined ? req.query.mode : 0;
  let user = null;
  try {
    user = await GetDailyUser(req.params.id, 0, 'id');
  } catch (err) {
    res.json({ error: 'Unable to get user' });
  }
  if (user !== null) {
    res.json(user);
  }
  // res.json(user);
});

router.get('/alt/registered/:id', limiter, cache('10 minutes'), async function (req, res, next) {
  try {
    const registered = await IsRegistered(req.params.id);
    res.json(registered);
  } catch (e) {
    res.json(e.message);
  }
});

router.get('/alt/registered', limiter, cache('10 minutes'), async function (req, res, next) {
  try {
    const users = await GetAllUsers();
    res.json(users);
  } catch (e) {
    res.json(e.message);
  }
});

router.get('/alt/get/:id', limiter, cache('10 minutes'), async function (req, res, next) {
  try {
    const user = await GetAltUser(req.params.id);
    res.json(user);
  } catch (e) {
    res.json(e.message);
  }
});

router.get('/alt/find/:query', limiter, cache('10 minutes'), async function (req, res, next) {
  try {
    const users = await FindUser(req.params.query, req.query.single);
    res.json(users);
  } catch (e) {
    res.json(e.message);
  }
});

router.get('/full/:id', limiter, cache('10 minutes'), async (req, res, next) => {
  let osuUser;
  let dailyUser;
  let altUser;

  try {
    // console.log('osu api');
    osuUser = await GetOsuUser(req.params.id, 'osu', 'id');
    // console.log('daily api');
    dailyUser = await GetDailyUser(req.params.id, 0, 'id');
    // console.log('alt api');
    altUser = await GetAltUser(req.params.id);
  } catch (e) {
    res.json(e.message);
  }

  res.json({
    osu: osuUser,
    daily: dailyUser,
    alt: altUser,
  });
});


module.exports = router;