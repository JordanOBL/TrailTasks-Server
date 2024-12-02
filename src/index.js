/* eslint-disable no-sparse-arrays */
/* eslint-disable prettier/prettier */

import {
    Achievement,
    Addon,
    Park,
    Completed_Hike,
    Park_State,
    SYNC,
    Session_Category,
    Subscription,
    Trail,
    User,
    User_Addon,
    User_Achievement,
    User_Purchased_Trail,
    User_Session,
    Session_Addon, Badge,
    User_Badge
} from './db/sequelizeModel.js';
// import pool from "./db/config.js";

import {Sequelize, Op, QueryTypes} from 'sequelize';
import achievementsWithIds from './assets/Achievements/addAchievementIds.js';
import bodyparser from 'body-parser';
import cors from 'cors';
import express from 'express';
import masterAchievementList from './assets/Achievements/masterAchievementList.js';
import dotenv from 'dotenv';
import cron from 'node-cron';
import {exec} from 'child_process';
import InitialBadges from "./helpers/Badges/InitialBadges";
import InitialParks from "./helpers/Parks/InitialParks";
import InitialParkStates from "./helpers/ParkState/InitialParkStates";
import InitialAddons from "./helpers/Addons/InitialAddons.js";
import InitialSessionCategories from "./helpers/Session/InitialSessionCategories.js";
import InitialTrails from "./helpers/Trails/InitialTrails";
// Load environment variables from the correct file based on the environment
dotenv.config({
    path: process.env.NODE_ENV === 'production' ? '.env.production' : '.env'
});

const newAchievements = achievementsWithIds(masterAchievementList);

export const sequelize = new Sequelize(process.env.PGDBNAME, process.env.PGUSER, process.env.PGPASSWORD, {
    host: process.env.PGHOST,
    port: process.env.PGPORT,
    dialect: 'postgres',
    // dialectOptions: {
    //   ssl: {
    //     require: true,
    //     rejectUnauthorized: false,
    //   },
    // },
});

const app = express();
app.use(express.json());
app.use(bodyparser.json());
app.use(bodyparser.urlencoded({extended: true}));
app.use('*', cors());

//app.use("/api/sync", router);
console.log(`Current working directory: ${process.cwd()}`);

//Cron Scheduler for Changing Free Parks each month
cron.schedule('10 3 * * 6', () => {
  console.log('Running Free Trail ReRoll Cron');
  exec('./src/cron/programs/rerollFreeTrails', (err, stdout, stderr) => {
    if (err) {
      console.error(`Error running Free Trail ReRoll Cron : ${err.message}`);
      return;
    }
    if (stderr) {
      console.error(`Stderr from Free Trail ReRoll Cron ${stderr}`);
      return;
    }
    console.log(`Output from Free Trail ReRoll Cron ${stdout}`);
  });
}, {timezone: "America/New_York"});

//Cron Scheduler for Changing Trail of the week
cron.schedule('10 3 * * 6', () => {
  console.log('Running Trail of The Week ReRoll Cron');
  exec('./src/cron/programs/rerollTrailOfTheWeek', (err, stdout, stderr) => {
    if (err) {
      console.error(`Error running Trail Of the Week Cron : ${err.message}`);
      return;
    }
    if (stderr) {
      console.error(`Stderr from Trail Of the Week Cron ${stderr}`);
      return;
    }
    console.log(`Output from Trail Of The Week Cron ${stdout}`);
  });
}, {timezone: "America/New_York"});

const findUser = async (req, res, next) => {
    const { email, password } = req.body;

    try {
        // Query the database for the user
        const user = await User.findOne({ where: { email, password } });
        console.log('user from server findUser()', user);

        // Set userId in res.locals
        if (user) {

            const userSubscription = await Subscription.findOne({ where: { user_id: user.id } });
            const userSessions = await User_Session.findAll({ where: { user_id: user.id } });
            const userPurchasedTrails = await User_Purchased_Trail.findAll({ where: { user_id: user.id } });
            const userAchievements = await User_Achievement.findAll({ where: { user_id: user.id } });
            const completedHikes = await Completed_Hike.findAll({where: {user_id: user.id}});
            res.locals.user = user;
            res.locals.userSubscription = userSubscription;
            res.locals.userSessions = userSessions;
            res.locals.userPurchasedTrails = userPurchasedTrails;
            res.locals.userAchievements = userAchievements;
            res.locals.completedHikes = completedHikes;

        } else {
            res.locals.user = null;
            res.locals.userSubscription = null;
            res.locals.userSessions = null;
            res.locals.userPurchasedTrails = null;
            res.locals.userAchievements = null;
            res.locals.userAchievements = null;
            res.locals.completedHikes = null;

        }

        // Continue to the next middleware/route handler
        return next();
    } catch (error) {
        // Handle any errors that occur
        console.error('Error in findUser middleware:', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
};
const getGlobalLeaderboards = async (req, res, next) => {
    const query = 'SELECT users.username, CAST(COALESCE(NULLIF(users.total_miles, \'\'), \'0.00\') AS DOUBLE PRECISION) AS total_miles  FROM users ' +
        'WHERE users.total_miles IS NOT NULL ' +
        'ORDER BY CAST(users.total_miles AS DOUBLE PRECISION) DESC ' +
        'LIMIT 100;'

    try {
        const [results, metadata] = await sequelize.query(query);

        if (results && results.length > 0) {
            res.locals.top100Rankings = results;
            console.log('Global Leaderboards:', results);
        } else {
            res.locals.top100Rankings = []; // Handle the case where no results are found
            console.log('No data found for the query');
        }

        return next();

    } catch (err) {
        console.error('Error in getGlobalLeaderboards:', err); // Improved error logging
        return next({ err, message: 'Error in server getGlobalLeaderboards' });
    }
}
const getUserRank = async (req, res, next) => {
    const { userId } = req.body;
    if (!userId) {
        return next(new Error('No User'));
    }
    try {
        const results = await sequelize.query(`
WITH RankedUsers AS (
SELECT
users.id AS user_id,
users.username,
CAST(COALESCE(NULLIF(users.total_miles, ''), '0.00') AS DOUBLE PRECISION) AS total_miles,
RANK() OVER (ORDER BY CAST(COALESCE(NULLIF(users.total_miles, ''), '0.00') AS DOUBLE PRECISION) DESC) AS rank
FROM users
)
SELECT *
FROM RankedUsers
WHERE user_id = $1
`,
            {
                bind: [userId],
                type: QueryTypes.SELECT,
            }// Ensures results are returned as objects
        );

        if (results.length > 0) {

            res.locals.userRank = results[0]; // Since you're likely getting an array, take the first item
            // Log the user's rank
        } else {
            res.locals.userRank = null;
            console.log('User not found');
        }
        return next();

    } catch (err) {
        return next({ err, message: 'Error in server getLeaderboards' });
    }
}
app.post('/api/users', findUser, async (req, res, next) => {
    const { user, userMiles, userSubscription, userSessions, userPurchasedTrails, userAchievements, completedHikes} = res.locals;

    if (user) {
        // Respond with userId if found
        return res.status(200).json({ user, userSubscription, userSessions, userPurchasedTrails, userAchievements, completedHikes });
    } else {
        // Respond with a 404 status code if user not found
        return res.status(404).json({ message: 'User not found' });
    }
});

app.post('/api/leaderboards', getGlobalLeaderboards, getUserRank, async (req, res, next)=>{
    const {top100Rankings, userRank} = res.locals;
    if (top100Rankings && userRank) {
        // Respond with userId if found
        return res.status(200).json({top100Rankings,userRank});
    } else {
        // Respond with a 404 status code if user not found
        return res.status(404).json({ message: 'No Data Found' });
    }
})

app.get('/api/seed', async (req, res) => {
    console.log('seeding postgres table...');
    try {
        await Park.bulkCreate(
            InitialParks,
            {ignoreDuplicates: true}
        );
        await Park_State.bulkCreate(
            InitialParkStates,
            {ignoreDuplicates: true}
        );
        await Trail.bulkCreate(
            InitialTrails, {ignoreDuplicates: true}
        );
        await Achievement.bulkCreate(newAchievements, {
            ignoreDuplicates: true,
        });

        await Session_Category.bulkCreate(
            InitialSessionCategories,
            {ignoreDuplicates: true}
        );
        await Addon.bulkCreate(
            InitialAddons,{ignoreDuplicates: true}
        )
        await Badge.bulkCreate(InitialBadges, {ignoreDuplicates: true})
        console.log('Seeding Server Successful');
        return res.status(200).json({message: 'Seeding Server Successful'});
    } catch (err) {
        console.log('Error in server seeding pgdb', err);
    }
});

const getSafeLastPulledAt = (lastPulledAt) =>
{
    console.debug({lastPulledAt})
    if (lastPulledAt !== 'null') {
        console.debug('last pulled at exists and it is', lastPulledAt);
        return new Date(parseInt(lastPulledAt, 10)).toISOString();
    }
    console.debug('last pulled does NOT exist and it is null', lastPulledAt);
    return new Date(0).toISOString();
};
//send updated and new changes to the user that were done after 'lastPulledAt
//*currently successfully send new users to users watermelon database !
app.get('/pull', async (req, res) => {
    try {
        let lastPulledAt = getSafeLastPulledAt(req.query.last_pulled_at);
        const userId = req.query.userId;
        console.debug('user in pull id', userId);
        console.log('last pulled at', {lastPulledAt});
        if (lastPulledAt === new Date(0).toISOString()) {
            console.log("Initial Data Pull From Server...")
            const createdAddons = await Addon.findAll({});
            const createdAchievements = await Achievement.findAll({});

            const createdParks = await Park.findAll({});

            const createdTrails = await Trail.findAll({});

            const createdParkStates = await Park_State.findAll({});

            const createdSessionCategories = await Session_Category.findAll({});

            const createdBadges = await Badge.findAll({});

            const responseData = {
                changes: {
                    addons: {
                        created:[],
                        updated: createdAddons,
                        deleted: [],
                    },
                    achievements: {
                        created:[],
                        updated: createdAchievements,
                        deleted: [],
                    },
                    parks: {
                        created:[],
                        updated: createdParks,
                        deleted: [],
                    },
                    trails: {
                        created:[],
                        updated: createdTrails,
                        deleted: [],
                    },
                    park_states: {
                        created:[],
                        updated: createdParkStates,
                        deleted: [],
                    },
                    session_categories: {
                        created: [],
                        updated:  createdSessionCategories,
                        deleted: [],
                    },
                    badges: {
                        created:[],
                        updated:  createdBadges,
                        deleted:[],
                    }
                },
                timestamp: Date.now(),
            };

            console.log('Initial Data Pull Complete...');
            return res.json(responseData);
        } else {
            console.log(`Server: sending all data changes for user: ${userId} since last device pull at: ${lastPulledAt} `)
            const createdAddons = await Addon.findAll({
                where: {
                    createdAt: {
                        [Sequelize.Op.gt]: lastPulledAt,
                    },
                },
            });
           const createdUserAddons = await User_Addon.findAll({
                where: {
                    createdAt: {
                        [Sequelize.Op.gt]: lastPulledAt,
                    },
                    user_id: userId,
                },
            });
            const createdParks = await Park.findAll({
                where: {
                    createdAt: {
                        [Sequelize.Op.gt]: lastPulledAt,
                    },
                },
            });
            const createdUsers = await User.findAll({
                where: {
                    createdAt: {
                        [Sequelize.Op.gt]: lastPulledAt,
                    },
                    id:{[Sequelize.Op.eq]: userId},
                },
            });
            const createdSubscriptions = await Subscription.findAll({
                where: {
                    createdAt: {
                        [Sequelize.Op.gt]: lastPulledAt,
                    },
                },
            });

            const createdTrails = await Trail.findAll({
                where: {
                    createdAt: {
                        [Sequelize.Op.gt]: lastPulledAt,
                    },
                },
            });
            const createdAchievements = await Achievement.findAll({
                where: {
                    createdAt: {
                        [Sequelize.Op.gt]: lastPulledAt,
                    },
                },
            });
            const createdUserAchievements = await User_Achievement.findAll({
                where: {
                    createdAt: {
                        [Sequelize.Op.gt]: lastPulledAt,
                    },
                    user_id: userId,
                },
            });
            const createdBadges = await Badge.findAll({
                where: {
                    createdAt: {
                        [Sequelize.Op.gt]: lastPulledAt,
                    },
                },
            });
            const createdUserBadges = await User_Badge.findAll({
                where: {
                    createdAt: {
                        [Sequelize.Op.gt]: lastPulledAt,
                    },
                    user_id: userId,
                },
            });
            const createdUserSessions = await User_Session.findAll({
                where: {
                    createdAt: {
                        [Sequelize.Op.gt]: lastPulledAt,
                    },
                    user_id: userId,
                },
            });
            const createdUserPurchasedTrails = await User_Purchased_Trail.findAll({
                where: {
                    createdAt: {
                        [Sequelize.Op.gt]: lastPulledAt,
                    },
                    user_id: userId,
                },
            });
            const createdParkStates = await Park_State.findAll({
                where: {
                    createdAt: {
                        [Sequelize.Op.gt]: lastPulledAt,
                    },
                },
            });
            const createdSessionCategories = await Session_Category.findAll({
                where: {
                    createdAt: {
                        [Sequelize.Op.gt]: lastPulledAt,
                    },
                },
            });

            const createdCompletedHikes = await Completed_Hike.findAll({
                where: {
                    updatedAt: {
                        [Sequelize.Op.gt]: lastPulledAt,
                    },
                    user_id: userId,
                },
            })

            const updatedSubscriptions = await Subscription.findAll({
                where: {
                    updatedAt: {
                        [Sequelize.Op.gt]: lastPulledAt,
                    },
                    user_id: userId,
                },
            });

            const updatedParks = await Park.findAll({
                where: {
                    updatedAt: {
                        [Sequelize.Op.gt]: lastPulledAt,
                    },
                },
            });
            const updatedUsers = await User.findAll({
                where: {
                    updatedAt: {
                        [Sequelize.Op.gt]: lastPulledAt,
                    },
                    id:{[Sequelize.Op.eq]: userId},
                },
            });
            const updatedAddons = await Addon.findAll({
                where: {
                    updatedAt: {
                        [Sequelize.Op.gt]: lastPulledAt,
                    },
                },
            })
            const updatedUserAddons = await User_Addon.findAll({
                where: {
                    updatedAt: {
                        [Sequelize.Op.gt]: lastPulledAt,
                    },
                    user_id: userId,
                },
            })
            const updatedBadges = await Badge.findAll({
                where: {
                    updatedAt: {
                        [Sequelize.Op.gt]: lastPulledAt,
                    },
                },
            })
            const updatedUserBadges = await User_Badge.findAll({
                where: {
                    updatedAt: {
                        [Sequelize.Op.gt]: lastPulledAt,
                    },
                    user_id: userId,
                },
            })
            const updatedUserSessions = await User_Session.findAll({
                where: {
                    updatedAt: {
                        [Sequelize.Op.gt]: lastPulledAt,
                    },
                    user_id: userId,
                },
            });

            const updatedTrails = await Trail.findAll({
                where: {
                    updatedAt: {
                        [Sequelize.Op.gt]: lastPulledAt,
                    },
                },
            });
            const updatedCompletedHikes = await Completed_Hike.findAll({
                where: {
                    updatedAt: {
                        [Sequelize.Op.gt]: lastPulledAt,
                    },
                    user_id: userId,
                },
            })
            //!Removed createdusers, createdUsersSubscriptinos, and created UsersMiles arrays. This removed the fail to update error.
            const responseData = {
                changes: {
                    addons: {
                        created: [],
                        updated: [...createdAddons, ...updatedAddons],
                        deleted: [],
                    },
                    parks: {
                        created: [],
                        updated: createdParks,
                        deleted: [],
                    },
                    users: {
                        created: [],
                        updated: updatedUsers.length ? updatedUsers : [],
                        deleted: [],
                    },
                users_addons: {
                    created: [],
                    updated: [...createdUserAddons, ...updatedUserAddons],
                    deleted: [],
                },
                    completed_hikes: {
                        created: [],
                        updated: updatedCompletedHikes.length ? updatedCompletedHikes : [],
                        deleted: [],
                    },
                    badges: {
                        created: [],
                        updated: createdBadges.length ? createdBadges : [],
                        deleted: [],
                    },
                    users_badges:{
                        created: [],
                        updated: createdUserBadges.length ? createdUserBadges : [],
                        deleted: [],
                    },
                    users_subscriptions: {
                        created: [],
                        updated: updatedSubscriptions.length ? updatedSubscriptions : [],
                        deleted: [],
                    },
                    users_achievements: {
                        created: [],
                        updated: createdUserAchievements,
                        deleted: [],
                    },
                    users_purchased_trails: {
                        created: [],
                        updated: createdUserPurchasedTrails,
                        deleted: [],
                    },
                    users_sessions: {
                        created: [],
                        updated: updatedUserSessions,
                        deleted: [],
                    },
                    trails: {
                        created: [],
                        updated: updatedTrails,
                        deleted: [],
                    },
                    park_states: {
                        created: [],
                        updated: createdParkStates,
                        deleted: [],
                    },
                    achievements: {
                        created: [],
                        updated: createdAchievements,
                        deleted: [],
                    },
                    session_categories: {
                        created: [],
                        updated: createdSessionCategories,
                        deleted: [],
                    },
                },
                timestamp: Date.now(),
            };

            console.log('responseData from pull', responseData);
            return res.json(responseData);
        }
    } catch (err) {
        console.log('Error in server /pull', err);
    }
});

//pull changes from users watermelon database
app.post('/push', async (req, res) => {
    try {
        const changes = await req.body.changes;
        const lastPulledAt = req.query.last_pulled_at;
        console.log('sending changes to pg', {changes, lastPulledAt});
        if (lastPulledAt !== 'null') {
            if (changes?.users?.created[0] !== undefined) {
                const users = await User.bulkCreate(changes.users.created, {updateOnDuplicate: ['id']});
            }
            if (changes?.users_achievements?.created[0] !== undefined) {
                const users_achievements = await User_Achievement.bulkCreate(
                    changes.users_achievements.created, {updateOnDuplicate: ['id']}
                );
            }
            if (changes?.users_addons?.created[0] !== undefined) {
                const users_addons = await User_Addon.bulkCreate(
                    changes.users_addons.created, {updateOnDuplicate: ['id']}
                );
            }
            if (changes?.users_badges?.created[0] !== undefined) {
                const users_addons = await User_Badge.bulkCreate(
                    changes.users_badges.created, {updateOnDuplicate: ['id']}
                );
            }
            if (changes?.users_sessions?.created[0] !== undefined) {
                const users_sessions = await User_Session.bulkCreate(
                    changes.users_sessions.created, {updateOnDuplicate: ['id']}
                );
            }
            if(changes?.sessions_addons?.created[0] !== undefined) {
                const sessions_addons = await Session_Addon.bulkCreate(
                    changes.sessions_addons.created, {updateOnDuplicate: ['id']}
                );
            }
            if (changes?.users_purchased_trails?.created[0] !== undefined) {
                const users_purchased_trails = await User_Purchased_Trail.bulkCreate(
                    changes.users_purchased_trails.created, {updateOnDuplicate: ['id']}
                );
            }
            if (changes?.users_subscriptions?.created[0] !== undefined) {
                const users_subscriptions = await Subscription.bulkCreate(
                    changes.users_subscriptions.created, {updateOnDuplicate: ['id']}
                );
            }
            if (changes?.completed_hikes?.created[0] !== undefined) {
                const completed_hikes = await Completed_Hike.bulkCreate(
                    changes.completed_hikes.created, {updateOnDuplicate: ['id']}
                );
            }
            //updates to created rows in pg database
            if (changes?.users?.updated[0] !== undefined) {
                const updateQueries = changes.users.updated.map((remoteEntry) => {
                    //console.log({remoteEntry});
                    return User.update({...remoteEntry}, {
                        where: {
                            id: remoteEntry.id,
                        },
                    });
                });
                await Promise.all(updateQueries);
            }

            if (changes?.users_addons?.updated[0] !== undefined) {
                const updateQueries = changes.users_addons.updated.map(
                    (remoteEntry) => {
                        console.log({remoteEntry});
                        return User_Addon.update(
                            {...remoteEntry},
                            {
                                where: {
                                    user_id: remoteEntry.user_id,
                                    addon_id: remoteEntry.addon_id,
                                },
                            }
                        );
                    }
                );
                await Promise.all(updateQueries);
            }
            if (changes?.users_sessions?.updated[0] !== undefined) {
                const updateQueries = changes.users_sessions.updated.map(
                    (remoteEntry) => {
                        //console.log({remoteEntry});
                        return User_Session.update(
                            {...remoteEntry},
                            {
                                where: {
                                    id: remoteEntry.id,
                                },
                            }
                        );
                    }
                );
                await Promise.all(updateQueries);
            }

            if (changes?.users_badges?.updated[0] !== undefined) {
                const updateQueries = changes.users_badges.updated.map(
                    (remoteEntry) => {
                        //console.log({remoteEntry});
                        return User_Badge.update(
                            {...remoteEntry},
                            {
                                where: {
                                    id: remoteEntry.id,
                                },
                            }
                        );
                    }
                );
                await Promise.all(updateQueries);
            }

            if(changes?.sessions_addons?.updated[0] !== undefined) {
                const updateQueries = changes.sessions_addons.updated.map(
                    (remoteEntry) => {
                        console.log({remoteEntry});
                        return Session_Addon.update(
                            {...remoteEntry},
                            {
                                where: {
                                    session_id: remoteEntry.session_id,
                                    addon_id: remoteEntry.addon_id,
                                },
                            }
                        );
                    }
                );
                await Promise.all(updateQueries);
            }
            if (changes?.users_achievements?.updated[0] !== undefined) {
                const updateQueries = changes.users_achievements.updated.map(
                    (remoteEntry) => {
                        //console.log({remoteEntry});
                        return User_Achievement.update(
                            {...remoteEntry},
                            {
                                where: {
                                    id: remoteEntry.id,
                                },
                            }
                        );
                    }
                );
                await Promise.all(updateQueries);
            }
            if (changes?.users_subscriptions?.updated[0] !== undefined) {
                const updateQueries = changes.users_subscriptions.updated.map(
                    (remoteEntry) => {
                        // console.log({remoteEntry});
                        return Subscription.update(
                            {...remoteEntry},
                            {
                                where: {
                                    id: remoteEntry.id,
                                },
                            }
                        );
                    }
                );
                await Promise.all(updateQueries);
            }
            if (changes?.completed_hikes?.updated[0] !== undefined) {
                const updateQueries = changes.completed_hikes.updated.map(
                    (remoteEntry) => {

                        return Completed_Hike.update(
                            {...remoteEntry},
                            {
                                where: {
                                    user_id: remoteEntry.user_id,
                                    trail_id: remoteEntry.trail_id,
                                },
                            }
                        );
                    }
                );
                await Promise.all(updateQueries);
            }
            if (changes?.users?.deleted[0]) {
                await User.destroy({
                    where: {
                        id: changes.users.deleted,
                    },
                });
            }
            if (changes?.users_addons?.deleted[0]) {
                await User_Addon.destroy({
                    where: {
                        id: changes.users_addons.deleted,
                    },
                });
            }
        }
        res.sendStatus(200);
    } catch (err) {
        console.error('Error in server /push:', err);
        res.status(500).json({ error: 'An error occurred during the push operation.' });
    }});
async function seedDatabase(){
    try {
        // Query the database for the user
        const trails = await Trail.findAll()

        // Set userId in res.locals
        if (trails.length > 0) {
            console.log("initial Database  already loaded")
            return
        }
        console.log('seeding postgres table...');
        try {
            await Park.bulkCreate(
                InitialParks,
                {ignoreDuplicates: true}
            );
            await Park_State.bulkCreate(
                InitialParkStates,
                {ignoreDuplicates: true}
            );
            await Trail.bulkCreate(
                InitialTrails, {ignoreDuplicates: true}
            );
            await Achievement.bulkCreate(newAchievements, {
                ignoreDuplicates: true,
            });

            await Session_Category.bulkCreate(
                InitialSessionCategories,
                {ignoreDuplicates: true}
            );
            await Addon.bulkCreate(
                InitialAddons,{ignoreDuplicates: true}
            )
            await Badge.bulkCreate(InitialBadges, {ignoreDuplicates: true})

            console.log('Seeding Server Successful');
        } catch (err) {
            console.log('Error in server seeding pgdb', err);
        }

    } catch (error) {
        // Handle any errors that occur
        console.error('Error in seedDatabase Function severside', error);
        return res.status(500).json({ error: 'Internal server error' });
    }
}
const connect = async () => {
    try {
        await SYNC({force: false, alter: true});
       await seedDatabase()
        console.log(
            'SERVER - connected to Postgres database trailtasks viia Sequelize!'
        );

        app.listen(5500, () => {
            console.log(
                'SERVER-listening and connected to express server trailtasks!'
            );
        });
    } catch (err) {
        console.log(err.message);
    }
};

connect().catch(e => {
    console.error("error in connect server", e)
});
