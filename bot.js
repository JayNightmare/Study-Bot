const { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, InteractionType, EmbedBuilder } = require('discord.js');
require('dotenv').config();
const { // * User Data:
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
        awardPointsToUser } = require('./commands/utils.js');

const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildVoiceStates]
});

const rest = new REST({ version: '10' }).setToken(process.env.TEST_TOKEN);

// Define the commands
const commands = [
    new SlashCommandBuilder()
        .setName('start')
        .setDescription('Start a study session with a custom duration')
        .addIntegerOption(option =>
            option.setName('duration')
                .setDescription('The study duration in minutes')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('status')
        .setDescription('Check the status of a study session using the session code')
        .addStringOption(option =>
            option.setName('code')
                .setDescription('The session code for the study session')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('stop')
        .setDescription('Stop the current study session with the session code')
        .addStringOption(option =>
            option.setName('code')
                .setDescription('The session code for the study session')
                .setRequired(true)
        ),

    new SlashCommandBuilder()
        .setName('leaderboard')
        .setDescription('Show the leaderboard')
];

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);

    try {
        const guilds = await client.guilds.fetch();
        guilds.forEach(async (guild) => {
            try {
                await rest.put(
                    Routes.applicationGuildCommands(client.user.id, guild.id),
                    { body: commands }
                );
            } catch (error) {
                console.error(`Error registering commands for guild: ${guild.id}`, error);
            }
        });
        console.log('Successfully registered application (/) commands.');
    } catch (error) {
        console.error(error);
    }
});

let sessions = new Map(); // Store active study sessions
let prompts = new Map(); // Store ongoing prompts when the host leaves

// Handle slash command interactions
client.on('interactionCreate', async interaction => {
    if (interaction.type !== InteractionType.ApplicationCommand) return;
    const { commandName } = interaction;

    if (commandName === 'start') {
        await interaction.deferReply();

        const duration = interaction.options.getInteger('duration');
        const user = interaction.user;
        const member = await interaction.guild.members.fetch(user.id);
        const voiceChannel = member.voice.channel;

        if (!voiceChannel) {
            const embed = new EmbedBuilder()
                .setTitle('Error')
                .setDescription('You need to be in a voice channel to start a study session.')
                .setColor(0xE74C3C); // Red for error
            await interaction.editReply({ embeds: [embed] });
            return;
        }

        // Generate a unique code for this session
        const sessionCode = generateSessionCode();

        // Store the session info
        sessions.set(sessionCode, {
            userId: user.id,
            voiceChannelId: voiceChannel.id,
            startTime: Date.now(),
            duration, 
            voiceChannelName: voiceChannel.name,
            guildId: interaction.guild.id,
            pointsPerMinute: 1
        });

        // Optionally, update the voice channel name
        await voiceChannel.setName(`${duration} [${sessionCode}]`).catch(console.error);

        const embed = new EmbedBuilder()
            .setTitle('Study Session Started')
            .setDescription(`Your study session has started! It will last for ${duration} minutes.`)
            .setColor(0x2ECC71) // Green for success
            .addFields([
                { name: 'Voice Channel', value: voiceChannel.name, inline: true },
                { name: 'Time', value: `${duration} minutes`, inline: true },
                { name: 'Session Code', value: sessionCode, inline: true }
            ]);

        await interaction.editReply({ embeds: [embed] });

        // Set a timeout to end the session after the specified duration
        setTimeout(async () => {
            const session = sessions.get(sessionCode);
            if (session) {
                // Rename the channel to "Study Completed"
                await voiceChannel.setName("Study Completed").catch(console.error);

                // Award points to VC members
                const points = session.pointsPerMinute * session.duration;
                await awardPointsToVCMembers(voiceChannel, session.duration);

                // Send completion message to text channel
                const textChannel = interaction.guild.systemChannel || interaction.channel; // Adjust this to your desired text channel
                const embedDone = new EmbedBuilder()
                    .setTitle('Well Done!')
                    .setDescription(`You've studied for ${session.duration} minutes!`)
                    .setColor(0x2ECC71); // Green for success
                await textChannel.send({ embeds: [embedDone] });

                // Notify users of the points they earned
                voiceChannel.members.forEach(async member => {
                    const memberEmbed = new EmbedBuilder()
                        .setTitle('Study Points Earned')
                        .setDescription(`You earned ${points} points for studying in this session!`)
                        .setColor(0x3498DB); // Blue for info
                    await member.send({ embeds: [memberEmbed] }).catch(console.error); // Send a DM to each member
                });

                sessions.delete(sessionCode); // Remove the session
            }
        }, duration * 60 * 1000); // Convert minutes to milliseconds
    } else if (commandName === 'status') {
        const sessionCode = interaction.options.getString('code').toUpperCase();

        if (!sessions.has(sessionCode)) {
            const embed = new EmbedBuilder()
                .setTitle('Invalid Code')
                .setDescription(`No active study session found with the code: ${sessionCode}.`)
                .setColor(0xE74C3C); // Red for error
            await interaction.reply({ embeds: [embed], ephemeral: true });
            return;
        }

        const session = sessions.get(sessionCode);
        const voiceChannel = await client.channels.fetch(session.voiceChannelId);

        if (!voiceChannel) {
            const embed = new EmbedBuilder()
                .setTitle('Error')
                .setDescription(`The voice channel for session code ${sessionCode} could not be found.`)
                .setColor(0xE74C3C); // Red for error
            await interaction.reply({ embeds: [embed], ephemeral: true });
            return;
        }

        // Calculate remaining time
        const elapsedMinutes = Math.floor((Date.now() - session.startTime) / 1000 / 60);
        const actualDuration = Math.min(session.duration, elapsedMinutes);
        // await awardPointsToVCMembers(voiceChannel, actualDuration);

        const remainingTime = Math.max(0, session.duration - elapsedMinutes);

        const embed = new EmbedBuilder()
            .setTitle('Study Session Status')
            .setDescription(`Status for session code: ${sessionCode}`)
            .setColor(0x3498DB) // Blue for info
            .addFields([
                { name: 'Voice Channel', value: voiceChannel.name, inline: true },
                { name: 'Remaining Time', value: `${remainingTime} minutes`, inline: true },
                { name: 'Members in VC', value: `${voiceChannel.members.size}`, inline: true }
            ]);
        await interaction.reply({ embeds: [embed], ephemeral: true });

    } else if (commandName === 'stop') {
        await interaction.deferReply();
    
        const user = interaction.user;
        const sessionCodeInput = interaction.options.getString('code').toUpperCase();
    
        if (!sessions.has(sessionCodeInput)) {
            const embed = new EmbedBuilder()
                .setTitle('Invalid Code')
                .setDescription(`No active study session found with the code: ${sessionCodeInput}.`)
                .setColor(0xE74C3C); // Red for error
            await interaction.editReply({ embeds: [embed], ephemeral: true });
            return;
        }
    
        const session = sessions.get(sessionCodeInput);
    
        // Check if the user is the host
        if (session.userId !== user.id) {
            const embed = new EmbedBuilder()
                .setTitle('Permission Denied')
                .setDescription('Only the host can stop the session.')
                .setColor(0xE74C3C); // Red for error
            await interaction.editReply({ embeds: [embed], ephemeral: true });
            return;
        }
    
        // Calculate actual time spent in the session (in minutes)
        const currentTime = Date.now();
        const actualTimeSpent = Math.floor((currentTime - session.startTime) / 1000 / 60); // Time in minutes
        const timeStudied = Math.min(actualTimeSpent, session.duration); // Cap at session duration
    
        const voiceChannel = await client.channels.fetch(session.voiceChannelId);
        await voiceChannel.setName("Study Completed").catch(console.error); // Rename channel
    
        const embedStop = new EmbedBuilder()
            .setTitle('Study Session Stopped')
            .setDescription(`The session with code ${sessionCodeInput} has been stopped. You studied for ${timeStudied} minutes.`)
            .setColor(0xE74C3C); // Red for stopped session
        await interaction.editReply({ embeds: [embedStop] });
    
        // Award points based on actual time spent
        await awardPointsToVCMembers(voiceChannel, timeStudied);
    
        sessions.delete(sessionCodeInput); // Remove the session
    } else if (commandName === 'leaderboard') {
        const leaderboard = await getLeaderboard(interaction.guild.id);
        const embed = new EmbedBuilder()
            .setTitle('Study Leaderboard')
            .setDescription(leaderboard.join('\n'))
            .setColor(0x9B59B6); // Purple for leaderboard
        interaction.reply({ embeds: [embed] });
    }
});

// Monitor voice state updates to detect when the host leaves
client.on('voiceStateUpdate', async (oldState, newState) => {
    // Check if a user left the voice channel
    if (!oldState.channelId && newState.channelId) {
        const joinTime = Date.now();
        await addUserSession(newState.member.id, newState.channel.id, joinTime);
    }

    if (oldState.channelId && !newState.channelId) {
        const leaveTime = new Date();
        const duration = await endUserSession(oldState.member.id, oldState.channel.id, leaveTime);

        // Calculate points based on session duration (1 point per minute)
        const points = Math.floor(duration / 60000); // Convert ms to minutes
        await awardPointsToUser(oldState.member.id, oldState.guild.id, points);
    }

    // Find if the user was a host of any session
    const session = [...sessions.values()].find(s => s.userId === oldState.member.id && s.voiceChannelId === oldState.channelId);
    if (!session) return;

    const voiceChannel = await client.channels.fetch(session.voiceChannelId);
    const textChannel = oldState.guild.systemChannel;

    if (voiceChannel.members.size === 0) {
        // No one is left in the channel, automatically end the session
        await voiceChannel.setName(session.voiceChannelName).catch(console.error);
        sessions.delete(session.sessionCode);
        await textChannel.send({ embeds: [embedStop] });
        await awardPointsToVCMembers(voiceChannel, session.duration);
    } else {
        // Prompt remaining members to continue or end the session
        const embedPrompt = new EmbedBuilder()
            .setTitle('Host Left')
            .setDescription(`The host has left. React with ✅ to continue or ❌ to end the session. The session will end in 1 minute if no one responds.`)
            .setColor(0xF1C40F); // Yellow for prompt
    
        const message = await textChannel.send({ embeds: [embedPrompt] });
        message.react('✅');
        message.react('❌');
    
        const filter = (reaction, user) => ['✅', '❌'].includes(reaction.emoji.name) && !user.bot;
        const collector = message.createReactionCollector({ filter, time: 60000 });
    
        collector.on('collect', async (reaction) => {
            if (reaction.emoji.name === '✅') {
                // Continue session
                const embedContinue = new EmbedBuilder()
                    .setTitle('Session Continued')
                    .setDescription('The session will continue!')
                    .setColor(0x2ECC71); // Green for success
                await textChannel.send({ embeds: [embedContinue] });
            } else {
                // End session
                await voiceChannel.setName(session.voiceChannelName).catch(console.error);
                sessions.delete(session.sessionCode);
                await awardPointsToVCMembers(voiceChannel, session.duration);
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
                // End session after timeout if no one responds
                await voiceChannel.setName(session.voiceChannelName).catch(console.error);
                sessions.delete(session.sessionCode);
                await awardPointsToVCMembers(voiceChannel, session.duration);
                const embedStop = new EmbedBuilder()
                    .setTitle('Session Ended')
                    .setDescription('No response was received. The session has ended.')
                    .setColor(0xE74C3C); // Red for stop
                await textChannel.send({ embeds: [embedStop] });
            }
        });
    }    
});

// Handle text message responses
client.on('messageCreate', async message => {
    if (!prompts.has(message.channel.id)) return;

    const { sessionCode, timeout } = prompts.get(message.channel.id);

    if (message.content.toLowerCase().startsWith('yes') && message.content.includes(sessionCode)) {
        clearTimeout(timeout);
        prompts.delete(message.channel.id);

        const embedContinue = new EmbedBuilder()
            .setTitle('Session Continued')
            .setDescription(`The session with code ${sessionCode} will continue!`)
            .setColor(0x2ECC71); // Green for success
        await message.channel.send({ embeds: [embedContinue] });
    } else if (message.content.toLowerCase() === 'no') {
        clearTimeout(timeout);
        prompts.delete(message.channel.id);

        const session = sessions.get(sessionCode);
        const voiceChannel = await client.channels.fetch(session.voiceChannelId);
        await voiceChannel.setName(session.voiceChannelName).catch(console.error);
        sessions.delete(sessionCode);

        const embedStop = new EmbedBuilder()
            .setTitle('Session Ended')
            .setDescription('The session has been stopped.')
            .setColor(0xE74C3C); // Red for stopped session
        await message.channel.send({ embeds: [embedStop] });

        await awardPointsToVCMembers(voiceChannel, session.duration);
    }
});

client.login(process.env.TEST_TOKEN);
