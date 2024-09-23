const { User, Server, Session } = require('../models/sequelize.js');
const { EmbedBuilder } = require('discord.js');
let userSessions = new Map(); // Key: userId, Value: { channelId, joinTime }

// * User Data:
async function updateUserStats(userId, serverId, studyTime) {
    try {
        let user = await User.findOne({ where: { userId, serverId } });
        
        if (!user) {
            user = await User.create({ userId, serverId });
        }

        user.studyStreak += 1;
        user.totalStudyTime += studyTime;
        user.points += studyTime; // Award points based on time studied

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

async function getUserData(serverId, userId) {
    const userData = await User.findOne({
        where: { serverId, userId }
    })

    return userData;
}

// //

// Fetch the leaderboard (top 10 users)
async function getLeaderboard(serverId) {
    const leaderboard = await User.findAll({
        where: { serverId },
        order: [['points', 'DESC']],
        limit: 10
    });

    return leaderboard.map((user, index) => `${index + 1}. <@${user.userId}> - ${user.points} points`);
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
async function awardPointsToVCMembers(voiceChannel, actualStudyTime) {
    const members = voiceChannel.members.filter(member => !member.user.bot); // Exclude bots

    for (const [memberId, member] of members) {
        await updateUserStats(memberId, voiceChannel.guild.id, actualStudyTime); // Update points for each user
    }
}

async function awardPointsToUser(userId, serverId, points) {
    let user = await User.findOne({ where: { userId, serverId } });
    
    if (!user) {
        // If user doesn't exist, create a new record
        user = await User.create({ userId, serverId });
    }

    user.points += points;
    await user.save();
    console.log(`Awarded ${points} points to user ${userId}. Total points: ${user.points}`);
}



// //

module.exports = {
    // * User Data:
    updateUserStats,
    addUserSession,
    endUserSession,
    getUserData,

    // * Leaderboard Data:
    getLeaderboard,

    // * Study Duration Data:
    getStudyDuration,
    generateSessionCode,

    // * Points Data:
    awardPointsToVCMembers,
    awardPointsToUser
}