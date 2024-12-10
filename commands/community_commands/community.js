const { logEvent, processLogs } = require("../logEvents");
const { Session, Server, User } = require("../../models/sequelize.js");
const { EmbedBuilder } = require("discord.js");

const {
    // * Leaderboard Data:
    getLeaderboard,

    // * Study Duration Data:
    generateSessionCode,

    // * Points Data:
    awardPointsToVCMembers,
} = require('../utils.js');

module.exports = {
    stats: {
        async execute(interaction) {
            const serverId = interaction.guild.id;
            logEvent(serverId, "Stats Command Run", "high");
            const server = await Server.findOne({
                where: { serverId: interaction.guild.id },
            });

            // defer reply
            await interaction.deferReply();

            if (server && server.textChannelId !== interaction.channelId) {
                const textChannelSet = null
                    ? `<#${server.textChannelId}>`
                    : "Text Channel Has Not Been Set";

                const embed = new EmbedBuilder()
                    .setTitle("Invalid Channel")
                    .setDescription(
                        "This command can only be used in the designated study session channel."
                    )
                    .addFields({
                        name: "Study Session Channel",
                        value: textChannelSet,
                    })
                    .setColor(0xe74c3c); // Red for error
                await interaction.editReply({
                    embeds: [embed],
                    ephemeral: true,
                });
                return;
            }

            // Fetch the user whose stats to show
            const user =
                interaction.options.getUser("user") || interaction.user;

            // Fetch user stats from the database
            const userData = await User.findOne({
                where: { userId: user.id, serverId: interaction.guild.id },
            });
            if (!userData) {
                const embed = new EmbedBuilder()
                    .setTitle("No Stats Found")
                    .setDescription(`No study stats found for ${user.tag}.`)
                    .setColor(0xe74c3c); // Red for error
                await interaction.editReply({ embeds: [embed] });
                return;
            }

            // Fetch leaderboard to get the user's rank
            const leaderboard = await getLeaderboard(interaction.guild.id);
            const userRank = leaderboard.find((u) => u.userId === user.id);

            const rankDisplay = userRank ? `#${userRank.rank}` : "Unranked";

            const embed = new EmbedBuilder()
                .setTitle(`${user.username}'s Study Stats`)
                .setThumbnail(user.displayAvatarURL()) // Display their avatar
                .addFields([
                    {
                        name: "⌛ Study Time ⌛ |",
                        value: `\`${userData.totalStudyTime}\` minutes`,
                        inline: true,
                    },
                    {
                        name: "🏅 Total Points 🏅",
                        value: `\`${userData.points}\``,
                        inline: true,
                    },
                    { name: "\u200B", value: "\u200B", inline: true },
                    {
                        name: "🔥 Study Streak 🔥",
                        value: `\`${userData.studyStreak}\` days`,
                        inline: true,
                    },
                    { name: "🏆 Rank 🏆", value: rankDisplay, inline: true },
                ])
                .setColor(0x3498db); // Blue for info

            await interaction.editReply({ embeds: [embed] });
        },
    },

    // //

    start: {
        async execute(interaction) {
            const serverId = interaction.guild.id;
            logEvent(serverId, "Start Session Command Run", "medium");
            try {
                console.log("Start Command Run");

                const duration = interaction.options.getInteger("duration");

                if (duration < 4) {
                    // Send embed saying, this is not long enough
                    const embed = new EmbedBuilder()
                        .setTitle("Invalid Duration")
                        .setDescription(
                            "The study duration must be at least 5 minutes."
                        )
                        .setColor(0xe74c3c);

                    await interaction.reply({
                        embeds: [embed],
                        ephemeral: true,
                    });
                } else {
                    await interaction.deferReply();

                    const user = interaction.user;
                    const member = await interaction.guild.members.fetch(
                        user.id
                    );
                    const voiceChannel = member.voice.channel;

                    const server = await Server.findOne({
                        where: { serverId: interaction.guild.id },
                    });
                    const displayServerChannel = server.textChannelId;

                    // if display server channel is null then display "/settextchannel"
                    if (!displayServerChannel) {
                        const embed = new EmbedBuilder()
                            .setTitle("No Text Channel Set")
                            .setDescription(
                                "This command can only be used in the designated study session channel"
                            )
                            .addFields({
                                name: "Study Session Channel",
                                value: `run \`/settextchannel\``,
                            })
                            .setColor(0xe74c3c); // Red for error
                        await interaction.editReply({
                            embeds: [embed],
                            ephemeral: true,
                        });
                        return;
                    }

                    if (
                        server &&
                        server.textChannelId !== interaction.channelId
                    ) {
                        const embed = new EmbedBuilder()
                            .setColor(0xe74c3c) // Red for error
                            .setTitle("Invalid Channel")
                            .setDescription(
                                "This command can only be used in the designated study session channel"
                            )
                            .addFields({
                                name: "Study Session Channel",
                                value: `<#${displayServerChannel}>`,
                            });
                        await interaction.editReply({
                            embeds: [embed],
                            ephemeral: true,
                        });
                        return;
                    }

                    if (!voiceChannel) {
                        const embed = new EmbedBuilder()
                            .setTitle("Error")
                            .setDescription(
                                "You need to be in a voice channel to start a study session."
                            )
                            .setColor(0xe74c3c); // Red for error
                        await interaction.editReply({ embeds: [embed] });
                        return;
                    }

                    // Check if the voice channel already has an active session
                    const activeSession = Array.from(sessions.values()).find(
                        (session) => session.voiceChannelId === voiceChannel.id
                    );

                    if (activeSession) {
                        // If a session is already active in this voice channel, prevent starting a new one
                        const embed = new EmbedBuilder()
                            .setTitle("Active Session Already Running")
                            .setDescription(
                                "There is already an active study session in this voice channel. You cannot start a new session until the current one ends."
                            )
                            .setColor(0xe74c3c); // Red for error
                        await interaction.editReply({
                            embeds: [embed],
                            ephemeral: true,
                        });
                        return;
                    }

                    // Generate a unique code for this session
                    sessionCode = generateSessionCode();

                    // Store the session info
                    sessions.set(sessionCode, {
                        userId: user.id,
                        voiceChannelId: voiceChannel.id,
                        startTime: Date.now(),
                        duration,
                        voiceChannelName: voiceChannel.name,
                        guildId: interaction.guild.id,
                        pointsPerMinute: 10,
                    });

                    // Optionally, update the voice channel name
                    voiceChannel
                        .setName(`${duration} [${sessionCode}]`)
                        .catch(console.error);

                    const embed = new EmbedBuilder()
                        .setTitle("Study Session Started")
                        .setDescription(
                            `Your study session has started! It will last for ${duration} minutes.`
                        )
                        .setColor(0x2ecc71) // Green for success
                        .addFields([
                            {
                                name: "Voice Channel",
                                value: voiceChannel.name,
                                inline: true,
                            },
                            {
                                name: "Time",
                                value: `${duration} minutes`,
                                inline: true,
                            },
                            {
                                name: "Session Code",
                                value: sessionCode,
                                inline: true,
                            },
                        ]);

                    await interaction.editReply({ embeds: [embed] });

                    // Set a timeout to end the session after the specified duration
                    setTimeout(async () => {
                        const session = sessions.get(sessionCode);
                        if (session) {
                            // Rename the channel to "Study VC"
                            await voiceChannel
                                .setName("Study VC")
                                .catch(console.error);
                            const textChannel =
                                interaction.guild.systemChannel ||
                                interaction.channel;

                            // Award points to VC members
                            const points =
                                session.pointsPerMinute * session.duration;
                            console.log(
                                `Points = ${
                                    session.pointsPerMinute * session.duration
                                }`
                            );
                            const members = voiceChannel.members.filter(
                                (member) => !member.user.bot
                            ); // Exclude bots

                            await awardPointsToVCMembers(voiceChannel, points);

                            // Send completion message to text channel
                            const embedDone = new EmbedBuilder()
                                .setTitle("Well Done!")
                                .setDescription(
                                    `You've studied for ${session.duration} minutes!`
                                )
                                .setColor(0x2ecc71); // Green for success
                            await textChannel.send({ embeds: [embedDone] });

                            // Create a list of users and the points they earned
                            let fields = [];
                            members.forEach((member) => {
                                fields.push({
                                    name: `${member.user.username}`,
                                    value: `${points} points`,
                                    inline: true, // Display them in rows
                                });
                            });

                            const pointsEmbed = new EmbedBuilder()
                                .setTitle("Study Points Earned!")
                                .setDescription(
                                    "Here are the points earned by each member:"
                                )
                                .setColor(0x9b59b6) // Purple for info
                                .addFields(fields); // Add the fields with users and points
                            await textChannel
                                .send({ embeds: [pointsEmbed] })
                                .catch(console.error);

                            // Clean up the session after sending the message
                            sessions.delete(sessionCode);
                        }
                    }, duration * 60 * 1000); // Convert minutes to milliseconds
                }
            } catch (err) {
                console.error("Error at Start: " + err);
                const embed = new EmbedBuilder()
                    .setTitle("⚠️ Session Start Error ⚠️")
                    .setDescription(
                        `There was an error starting your session. Try again in 5 mins for a break `
                    )
                    .setColor(0x2ecc71) // Green for success
                    .addFields([
                        {
                            name: "Voice Channel",
                            value: voiceChannel.name,
                            inline: true,
                        },
                        {
                            name: "Time",
                            value: `${duration} minutes`,
                            inline: true,
                        },
                        {
                            name: "Session Code",
                            value: sessionCode,
                            inline: true,
                        },
                    ]);

                await interaction.editReply({ embeds: [embed] });
            }
        },
    },

    // //

    status: {
        async execute(interaction) {
            const serverId = interaction.guild.id;
            logEvent(serverId, "Check Session Status Command Run", "medium");

            const sessionCode = interaction.options
                .getString("code")
                .toUpperCase();

            const server = await Server.findOne({
                where: { serverId: interaction.guild.id },
            });

            if (server && server.textChannelId !== interaction.channelId) {
                const embed = new EmbedBuilder()
                    .setColor(0xe74c3c) // Red for error
                    .setTitle("Invalid Channel")
                    .setDescription(
                        "This command can only be used in the designated study session channel"
                    )
                    .addFields({
                        name: "Study Session Channel",
                        value: `<#${server.textChannelId}>`,
                    });
                return await interaction.editReply({
                    embeds: [embed],
                    ephemeral: true,
                });
            }

            if (!sessions.has(sessionCode)) {
                const embed = new EmbedBuilder()
                    .setTitle("Invalid Code")
                    .setDescription(
                        `No active study session found with the code: ${sessionCode}.`
                    )
                    .setColor(0xe74c3c); // Red for error
                await interaction.reply({ embeds: [embed], ephemeral: true });
                return;
            }

            const session = sessions.get(sessionCode);
            const voiceChannel = await client.channels.fetch(
                session.voiceChannelId
            );

            if (!voiceChannel) {
                const embed = new EmbedBuilder()
                    .setTitle("Error")
                    .setDescription(
                        `The voice channel for session code ${sessionCode} could not be found.`
                    )
                    .setColor(0xe74c3c); // Red for error
                await interaction.reply({ embeds: [embed], ephemeral: true });
                return;
            }

            // Calculate remaining time
            const elapsedMinutes = Math.floor(
                (Date.now() - session.startTime) / 1000 / 60
            );

            // Keep incase of error
            // const actualDuration = Math.min(session.duration, elapsedMinutes);
            // await awardPointsToVCMembers(voiceChannel, actualDuration);

            const remainingTime = Math.max(
                0,
                session.duration - elapsedMinutes
            );

            const embed = new EmbedBuilder()
                .setTitle("Study Session Status")
                .setDescription(`Status for session code: ${sessionCode}`)
                .setColor(0x3498db) // Blue for info
                .addFields([
                    {
                        name: "Voice Channel",
                        value: voiceChannel.name,
                        inline: true,
                    },
                    {
                        name: "Remaining Time",
                        value: `${remainingTime} minutes`,
                        inline: true,
                    },
                    {
                        name: "Members in VC",
                        value: `${voiceChannel.members.size}`,
                        inline: true,
                    },
                ]);
            await interaction.reply({ embeds: [embed], ephemeral: true });
        },
    },

    // //

    stop: {
        async execute(interaction) {
            const serverId = interaction.guild.id;
            logEvent(serverId, "Stop Session Command Run", "medium");
            console.log("Stop command triggered");

            await interaction.deferReply();

            const server = await Server.findOne({
                where: { serverId: interaction.guild.id },
            });

            if (server?.textChannelId !== interaction.channelId) {
                const embed = new EmbedBuilder()
                    .setColor(0xe74c3c) // Red for error
                    .setTitle("Invalid Channel")
                    .setDescription(
                        "This command can only be used in the designated study session channel"
                    )
                    .addFields({
                        name: "Study Session Channel",
                        value: `<#${server.textChannelId}>`,
                    });

                return await interaction.editReply({
                    embeds: [embed],
                    ephemeral: true,
                });
            }

            const user = interaction.user;
            const sessionCodeInput = interaction.options
                .getString("code")
                .toUpperCase();

            if (!sessions.has(sessionCodeInput)) {
                const embed = new EmbedBuilder()
                    .setTitle("Invalid Code")
                    .setDescription(
                        `No active study session found with the code: ${sessionCodeInput}.`
                    )
                    .setColor(0xe74c3c); // Red for error
                await interaction.editReply({
                    embeds: [embed],
                    ephemeral: true,
                });
                return;
            }

            const session = sessions.get(sessionCodeInput);

            // Check if the user is the host
            if (session.userId !== user.id) {
                const embed = new EmbedBuilder()
                    .setTitle("Permission Denied")
                    .setDescription("Only the host can stop the session.")
                    .setColor(0xe74c3c); // Red for error
                await interaction.editReply({
                    embeds: [embed],
                    ephemeral: true,
                });
                return;
            }

            // Calculate actual time spent in the session (in minutes)
            const currentTime = Date.now();
            const actualTimeSpent = Math.floor(
                (currentTime - session.startTime) / 1000 / 60
            ); // Time in minutes
            const timeStudied = Math.min(actualTimeSpent, session.duration); // Cap at session duration
            const points = timeStudied * session.pointsPerMinute;

            const voiceChannel = await client.channels.fetch(
                session.voiceChannelId
            );
            voiceChannel.setName("Study Completed").catch(console.error); // Rename channel

            const embedStop = new EmbedBuilder()
                .setTitle("Study Session Stopped")
                .setDescription(
                    `The session with code ${sessionCodeInput} has been stopped. You studied for ${timeStudied} minutes.`
                )
                .setColor(0xe74c3c); // Red for stopped session
            await interaction.editReply({ embeds: [embedStop] });

            // Award points based on actual time spent
            console.log(
                "On Stop Command: Award Points To VC Members: " +
                    timeStudied +
                    " minutes"
            );
            await awardPointsToVCMembers(voiceChannel, points, timeStudied);

            sessions.delete(sessionCodeInput); // Remove the session
        },
    },

    // //

    leaderboard: {
        async execute(interaction) {
            const serverId = interaction.guild.id;
            logEvent(serverId, "Leaderboard Command Run", "high");

            await interaction.deferReply();

            const leaderboardData = await getLeaderboard(interaction.guild.id);

            const server = await Server.findOne({
                where: { serverId: interaction.guild.id },
            });

            if (server && server.textChannelId !== interaction.channelId) {
                const embed = new EmbedBuilder()
                    .setColor(0xe74c3c) // Red for error
                    .setTitle("Invalid Channel")
                    .setDescription(
                        "This command can only be used in the designated study session channel"
                    )
                    .addFields({
                        name: "Study Session Channel",
                        value: `<#${server.textChannelId}>`,
                    });
                await interaction.editReply({
                    embeds: [embed],
                    ephemeral: true,
                });
                return;
            }

            if (leaderboardData && leaderboardData.length > 0) {
                const embed = new EmbedBuilder()
                    .setTitle("Study Leaderboard")
                    .setDescription(leaderboardData.join("\n"))
                    .setColor(0x9b59b6); // Purple for leaderboard
                interaction.editReply({ embeds: [embed] });
            } else {
                const embed = new EmbedBuilder()
                    .setTitle("Leaderboard")
                    .setDescription("No data available.")
                    .setColor(0xe74c3c); // Red for error
                interaction.editReply({ embeds: [embed] });
            }
        },
    },

    // //

    focus: {
        async execute(interaction) {
            const serverId = interaction.guild.id;
            logEvent(serverId, 'Focus Command Run', 'medium');

            const enableFocus = interaction.options.getBoolean('enable');

            const focusRole = interaction.guild.roles.cache.find(role => role.name === 'Focus');
            if (!focusRole) return interaction.editReply({ content: 'Focus role not found', ephemeral: true });

            if (enableFocus) {
                await interaction.member.roles.add(focusRole);
                await interaction.reply({ content: 'Focus mode enabled. You will now have limited access for better concentration.', ephemeral: true });
            } else {
                await interaction.member.roles.remove(focusRole);
                await interaction.reply({ content: 'Focus mode disabled. You now have access to all channels again.', ephemeral: true });
            }

            // Fetch the user from the database
            let user = await User.findOne({ where: { userId: interaction.user.id, serverId: serverId } });

            if (!user) {
                // Create the user in the database if they don't exist
                user = await User.create({
                    userId: interaction.user.id,
                    serverId: serverId,
                    focusEnabled: enableFocus
                });
            } else {
                // Update the user's focus mode
                user.focusEnabled = enableFocus;
                user.save();
            }

            // Respond to the user
            if (enableFocus) {
                await interaction.editReply({ content: 'Focus mode enabled. You will now have limited access for better concentration.', ephemeral: true });
            } else {
                await interaction.editReply({ content: 'Focus mode disabled. You now have access to all channels again.', ephemeral: true });
            }
        }
    }
};
