const { User, Server, Session } = require('../models/sequelize.js');
const { EmbedBuilder } = require('discord.js');
let userSessions = new Map(); // Key: userId, Value: { channelId, joinTime }

// * User Data:
async function updateUserStats(userId, serverId, studyTime) {
    try {
        let user = await User.findOne({ where: { userId, serverId } });
        console.log(userId);
        
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
    // Fetch the active session from the database based on userId, channelId, and guildId
    const session = await Session.findOne({
        where: {
            userId: userId,
            channelId: channelId,
            guildId: guildId,
            active: true // Only look for active sessions
        }
    });

    if (!session) {
        console.error("No active session found for the user.");
        return 0; // No session found
    }

    // Calculate the session duration (in milliseconds)
    const sessionDuration = leaveTime - session.startTime;

    // Mark session as inactive (ended)
    session.active = false;
    session.leaveTime = leaveTime;
    await session.save();

    // Return the session duration in milliseconds
    return sessionDuration;
}

// //

// Fetch the leaderboard (top 10 users)
async function getLeaderboard(serverId) {
    const leaderboard = await User.findAll({
        where: { serverId },
        order: [['points', 'DESC']],
        limit: 10
    });

    return leaderboard.map((user, index) => ({
        userId: user.userId,
        points: user.points
    }));

    // Alternatively, you can also display the leaderboard as a formatted string:
    // return leaderboard.map((user, index) => `${index + 1}. <@${user.userId}> - ${user.points} points`);
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
    const serverId = voiceChannel.guild.id;
    const members = voiceChannel.members.filter(member => !member.user.bot); // Exclude bots
    const memberIds = Array.from(members.keys()); // Extract user IDs
    const points = actualStudyTime;

    console.log(`Points: ${points}\nMembers: ${memberIds}\nServer Id: ${serverId}`);

    try {
        console.log("Main Update Method");
        for (const memberId of memberIds) { await updateUserStats(memberId, serverId, points); }
    }
    catch(err) {
        console.error("Backup Update Method: " + err);
        for (const memberId of memberIds) { await awardPointsToUser(memberId, serverId, points) }
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
    handleSessionReactions
}