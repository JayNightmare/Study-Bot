const { User, Server, Session } = require('../models/sequelize.js');
const { EmbedBuilder } = require('discord.js');
let userSessions = new Map(); // Key: userId, Value: { channelId, joinTime }

// * User Data:
async function updateUserStats(userId, serverId, studyTime, points) {
    try {
        let user = await User.findOne({ where: { userId, serverId } });
        console.log(userId);
        
        if (!user) {
            user = await User.create({ userId, serverId });
        }

        user.studyStreak += 1;
        user.totalStudyTime += studyTime;
        user.points += points; // Award points based on time studied

        console.log(`User ${userId} now has ${user.points} points.`);
        await user.save();
        
        return user;
    } catch (error) {
        console.error(`Failed to update stats for user ${userId}: ${error.message}`);
    }
}

async function addUserSession(userId, channelId, joinTime, guildId) {
    // Check if there is an existing active session for this user in the same server
    const existingSession = await Session.findOne({
        where: { userId, guildId, active: true }
    });

    if (existingSession) {
        // Update the session with new join time and channel ID
        existingSession.joinTime = joinTime;
        existingSession.channelId = channelId;
        await existingSession.save();
        console.log(`Updated session for user ${userId} in guild ${guildId}`);
    } else {
        // Create a new session entry
        await Session.create({
            userId,
            guildId,
            channelId,
            joinTime,
            active: true // Mark this session as active
        });
        console.log(`Created a new session for user ${userId} in guild ${guildId}`);
    }
}

async function endUserSession(userId, channelId, leaveTime, guildId) {
    // Find the active session for the user in the given server
    const session = await Session.findOne({
        where: { userId, guildId, active: true }
    });

    if (!session) {
        console.error(`No active session found for user ${userId} in guild ${guildId}`);
        return 0;
    }

    // Calculate the duration the user spent in the session (in milliseconds)
    const sessionDuration = leaveTime - new Date(session.joinTime);

    // Remove the session after ending it
    await Session.destroy({
        where: { userId, guildId, active: true }
    });
    console.log(`Removed session for user ${userId} in guild ${guildId}`);

    // Return the session duration in milliseconds for point calculation
    return sessionDuration;
}

// //

// Fetch the leaderboard (top 10 users)
async function getLeaderboard(guildId) {
    // Fetch all users for this server
    const users = await User.findAll({ where: { serverId: guildId } });

    // Sort users by points (descending)
    users.sort((a, b) => b.points - a.points);

    // Initialize an array to hold ranked users
    let rank = 1;
    let rankedUsers = [];

    // Assign ranks, handling ties
    users.forEach((user, index) => {
        // If not the first user and the points are equal to the previous user, assign the same rank
        if (index > 0 && user.points === users[index - 1].points) {
            rankedUsers.push({ ...user.dataValues, rank: rankedUsers[index - 1].rank });
        } else {
            // Otherwise, assign a new rank
            rankedUsers.push({ ...user.dataValues, rank: rank });
        }
        rank++;
    });

    return rankedUsers;
}

// //

async function getStudyDuration(serverId) {
    let server = await Server.findOne({ where: { serverId } });

    if (!server) {
        // Create default settings for the server if it doesn't exist
        server = await Server.create({ serverId });
    }

    return server.customStudyDuration;
}

// Helper function to generate a unique session code
function generateSessionCode() {
    return Math.random().toString(36).substr(2, 5).toUpperCase(); // Example: Generates a 5-character code
}

// //

// Award points to all members in the voice channel
async function awardPointsToVCMembers(voiceChannel, points, actualTimeSpent) {
    const serverId = voiceChannel.guild.id;
    const members = voiceChannel.members.filter(member => !member.user.bot); // Exclude bots
    const memberIds = Array.from(members.keys()); // Extract user IDs

    console.log(`Points: ${points}\nMembers: ${memberIds}\nServer Id: ${serverId}\nTime Spent: ${actualTimeSpent}`);

    try {
        console.log("Main Update Method");
        for (const memberId of memberIds) { await updateUserStats(memberId, serverId, actualTimeSpent, points); }
    }
    catch(err) {
        console.error("Points Couldn't Be Updated: " + err);
    }
}

async function awardPointsToUser(userId, serverId, points) {
    let user = await User.findOne({ where: { userId, serverId } });
    
    if (!user) {
        // If user doesn't exist, create a new 
        user = await User.create({ userId, serverId });
    }

    user.points += points;
    await user.save();
    console.log(`Awarded ${points} points to user ${userId}. Total points: ${user.points}`);
}

// //

async function handleSessionReactions(message, session, voiceChannel, textChannel) {
    try {
        await message.react('✅');
        await message.react('❌');

        const filter = (reaction, user) => ['✅', '❌'].includes(reaction.emoji.name) && !user.bot;
        const collector = message.createReactionCollector({ filter, time: 60000 });

        collector.on('collect', async (reaction) => {
            if (reaction.emoji.name === '✅' || reaction.emoji.name === '\u2705') {
                const embedContinue = new EmbedBuilder()
                    .setTitle('Session Continued')
                    .setDescription('The session will continue!')
                    .setColor(0x2ECC71); // Green for success
                await textChannel.send({ embeds: [embedContinue] });
            } else if (reaction.emoji.name === '❌' || reaction.emoji.name === '\u274C') {
                await voiceChannel.setName(session.voiceChannelName).catch(console.error);
                sessions.delete(session.sessionCode);
                await awardPointsToVCMembers(voiceChannel, session.duration, textChannel);
                const embedStop = new EmbedBuilder()
                    .setTitle('Session Ended')
                    .setDescription('The session has ended.')
                    .setColor(0xE74C3C); // Red for stop
                await textChannel.send({ embeds: [embedStop] });
            }

            collector.stop();
        });

        collector.on('end', async () => {
            if (!collector.collected.size) {
                await voiceChannel.setName(session.voiceChannelName).catch(console.error);
                sessions.delete(session.sessionCode);
                await awardPointsToVCMembers(voiceChannel, session.duration, textChannel);
                const embedStop = new EmbedBuilder()
                    .setTitle('Session Ended')
                    .setDescription('No response was received. The session has ended.')
                    .setColor(0xE74C3C); // Red for stop
                await textChannel.send({ embeds: [embedStop] });
            }
        });
    } catch (error) {
        console.error("Failed to handle reactions:", error);
    }
}

// //

module.exports = {
    // * User Data:
    updateUserStats,
    addUserSession,
    endUserSession,

    // * Leaderboard Data:
    getLeaderboard,

    // * Study Duration Data:
    getStudyDuration,
    generateSessionCode,

    // * Points Data:
    awardPointsToVCMembers,
    awardPointsToUser,

    // * Session Data:
    handleSessionReactions,
}