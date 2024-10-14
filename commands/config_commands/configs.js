const { logEvent, processLogs } = require("../logEvents");
const { Session, Server, User } = require("../../models/sequelize.js");
const { EmbedBuilder } = require("discord.js");

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
    awardPointsToUser,

    // * Session Data:
    handleSessionReactions,
} = require('../utils.js');

module.exports = {
    settextchannel: {
        async execute(interaction, options) {
            const serverId = interaction.guild.id;
            logEvent(serverId, "Set Text Channel Command Run", "low");

            const channel = options.getChannel("channel");

            let server = await Server.findOne({
                where: { serverId: interaction.guild.id },
            });

            // Find or create the server record in the database
            if (!server) {
                server = await Server.create({ serverId: serverId });
            }

            // Update the text channel ID in the database
            server.textChannelId = channel.id;
            await server.save();

            await interaction.reply(`Text channel has been set to ${channel}.`);
        },
    },

    // //

    removetextchannel: {
        async execute(interaction) {
            const serverId = interaction.guild.id;
            logEvent(serverId, "Remove Text Channel Command Run", "low");

            let server = await Server.findOne({
                where: { serverId: interaction.guild.id },
            });
            if (!server) {
                server = await Server.create({ serverId: serverId });
            }

            // remove channel id
            server.textChannelId = null;
            await server.save();

            await interaction.reply(`Text channel has been removed.`);
        },
    },

    // //

    setloggingchannel: {
        async execute(interaction, options) {
            const serverId = interaction.guild.id;
            logEvent(serverId, "Set Logging Channel Command Run", "low");

            const channel = options.getChannel("channel");

            // Find or create the server record in the database
            let server = await Server.findOne({
                where: { serverId: serverId },
            });
            if (!server) {
                server = await Server.create({ serverId: serverId });
            }

            // Update the logging channel ID in the database
            server.loggingChannelId = channel.id;
            await server.save();

            await interaction.reply(
                `Logging channel has been set to ${channel}.`
            );
        },
    },

    // //

    setloglevel: {
        async execute(interaction) {
            const serverId = interaction.guild.id;
            logEvent(serverId, "Set Log Level Command Run", "low");

            const level = interaction.options.getString("level");

            if (
                !interaction.member.permissions.has(
                    PermissionsBitField.Flags.Administrator
                )
            ) {
                return interaction.reply({
                    content: "You need to be an admin to run this command.",
                    ephemeral: true,
                });
            }

            let server = await Server.findOne({
                where: { serverId: serverId },
            });
            if (!server) {
                return interaction.reply({
                    content: "Server not found in the database.",
                    ephemeral: true,
                });
            }

            server.logLevel = level;
            await server.save();

            await interaction.reply({
                content: `Log level set to ${level}`,
                ephemeral: true,
            });
        },
    },

    setup: {
        async execute(interaction) {
            logEvent(serverId, "Setup Command Run", "low");
            if (
                !interaction.member.permissions.has(
                    PermissionsBitField.Flags.Administrator
                )
            ) {
                return interaction.reply({
                    content: "You need to be an admin to run this command.",
                    ephemeral: true,
                });
            }

            const numVoiceChannels =
                interaction.options.getInteger("voice_channels");

            // Check if the server is already setup
            let server = await Server.findOne({
                where: { serverId: interaction.guild.id },
            });
            if (server?.textChannelId) {
                return interaction.reply({
                    content: "This server is already set up.",
                    ephemeral: true,
                });
            }

            try {
                // Defer the reply to allow time for the setup to complete
                await interaction.deferReply({ ephemeral: true });

                // Step 1: Create a category
                const category = await interaction.guild.channels.create({
                    name: "Study Focus",
                    type: 4, // Category type
                    permissionOverwrites: [
                        {
                            id: interaction.guild.id,
                            allow: [PermissionsBitField.Flags.ViewChannel],
                        },
                        {
                            id: interaction.guild.id,
                            allow: [PermissionsBitField.Flags.SendMessages],
                        },
                        {
                            id: interaction.guild.id,
                            deny: [PermissionsBitField.Flags.Connect], // Prevent people joining a focus session
                        },
                    ],
                });

                // Step 2: Create a text channel in the category
                const textChannel = await interaction.guild.channels.create({
                    name: "study-text",
                    type: 0, // Text channel type
                    parent: category.id, // Place it under the category
                    // permissionOverwrites: [
                    //     {
                    //         id: interaction.guild.id, // Default permissions for everyone
                    //         deny: [PermissionsBitField.Flags.ViewChannel], // Hide it for everyone except focus role
                    //     }
                    // ]
                });

                // Step 3: Create voice channels in the category
                for (let i = 1; i <= numVoiceChannels; i++) {
                    await interaction.guild.channels.create({
                        name: `Study VC ${i}`,
                        type: 2, // Voice channel type
                        parent: category.id, // Place it under the category
                        permissionOverwrites: [
                            {
                                id: interaction.guild.id, // Default permissions for everyone
                                deny: [PermissionsBitField.Flags.ViewChannel], // Hide it for everyone except focus role
                            },
                        ],
                    });
                }

                // Step 4: Create the Focus role
                let focusRole = interaction.guild.roles.cache.find(
                    (role) => role.name === "Focus"
                );
                if (!focusRole) {
                    focusRole = await interaction.guild.roles.create({
                        name: "Focus",
                        color: 0xe71563, // Use your custom hex color code
                        reason: "Role for focused study sessions",
                    });
                }

                // Step 5: Update permissions for all other channels to deny view for Focus role
                interaction.guild.channels.cache.forEach((channel) => {
                    if (channel.parentId !== category.id) {
                        // Don't modify the new category
                        channel.permissionOverwrites.edit(focusRole, {
                            ViewChannel: false, // Hide other channels from focus role
                        });
                    } else {
                        channel.permissionOverwrites.edit(focusRole, {
                            ViewChannel: true, // Allow view of new study channels
                            SendMessages: true, // Allow send messages for study channels
                        });
                    }
                });

                // Step 6: Save the text channel ID to the database
                if (!server) {
                    server = await Server.create({
                        serverId: interaction.guild.id,
                        textChannelId: textChannel.id, // Store the text channel ID
                        customStudyDuration: 25, // Default settings
                        customBreakDuration: 5,
                    });
                } else {
                    server.textChannelId = textChannel.id;
                    await server.save();
                }

                const embed = new EmbedBuilder()
                    .setTitle("Study Setup")
                    .setDescription("Study setup complete!")
                    .addFields([
                        {
                            name: "Study Session Channel",
                            value: `<#${textChannel.id}>`,
                        },
                        {
                            name: "Voice Channels",
                            value: `${numVoiceChannels} voice channels created`,
                        },
                    ])
                    .setColor(0x2ecc71);
                await interaction.editReply({
                    embeds: [embed],
                    ephemeral: true,
                });
            } catch (error) {
                console.error("Setup failed:", error);
                const embed = new EmbedBuilder()
                    .setTitle("Error")
                    .setDescription(
                        "An error occurred during setup. Make sure I have the Manage Server and Manage Channels permissions!"
                    )
                    .setColor(0xe74c3c);
                await interaction.editReply({
                    embeds: [embed],
                    ephemeral: true,
                });
            }
        },
    },
};
