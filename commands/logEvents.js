const { EmbedBuilder } = require('discord.js');
const { Server } = require('../models/sequelize.js') // Adjust path to your database models

const logBuffers = {}; // Store logs by serverId

async function logEvent(serverId, logMessage, level) {
    const server = await Server.findOne({ where: { serverId } });
    if (!server?.logLevel) return;

    const logLevels = ['low', 'medium', 'high'];
    const currentLogLevelIndex = logLevels.indexOf(server.logLevel);
    const eventLogLevelIndex = logLevels.indexOf(level);

    if (eventLogLevelIndex <= currentLogLevelIndex) {
        if (!logBuffers[serverId]) {
            logBuffers[serverId] = [];
        }
        logBuffers[serverId].push(logMessage);
    }
}

async function processLogs(client) {
    for (const serverId in logBuffers) {
        const logs = logBuffers[serverId];
        if (logs.length === 0) continue;

        const server = await Server.findOne({ where: { serverId } });
        if (!server?.loggingChannelId) continue;

        const loggingChannel = await client.channels.fetch(server.loggingChannelId);
        if (!loggingChannel) continue;

        const embed = new EmbedBuilder()
            .setTitle('Logs for the Last 3 Minutes')
            .setColor(0x3498DB)
            .setDescription(logs.join('\n'))
            .setTimestamp();

        await loggingChannel.send({ embeds: [embed] }).catch(console.error);

        logBuffers[serverId] = []; // Clear the log buffer for the next interval
    }
}

module.exports = { logEvent, processLogs };