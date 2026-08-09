import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1786311672585 implements MigrationInterface {
  name = 'InitialSchema1786311672585';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE TABLE \`messages\` (\`id\` varchar(36) NOT NULL, \`tenantId\` varchar(255) NOT NULL, \`conversationId\` varchar(255) NOT NULL, \`clientId\` varchar(255) NOT NULL, \`role\` enum ('user', 'assistant', 'system') NOT NULL, \`content\` text NOT NULL, \`rawJson\` json NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), INDEX \`IDX_751332fc6cc6fc576c6975cd07\` (\`conversationId\`, \`createdAt\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`conversations\` (\`id\` varchar(36) NOT NULL, \`tenantId\` varchar(255) NOT NULL, \`clientId\` varchar(255) NOT NULL, \`currentState\` enum ('IDLE', 'HUMAN_HANDOFF') NOT NULL DEFAULT 'IDLE', \`contextJson\` json NULL, \`lastMessageAt\` timestamp NULL, \`handoffRequestedAt\` datetime NULL, \`handoffReason\` varchar(64) NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX \`IDX_165a87f59f19ac000f70cdcdab\` (\`tenantId\`, \`clientId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`clients\` (\`id\` varchar(36) NOT NULL, \`tenantId\` varchar(255) NOT NULL, \`phone\` varchar(255) NULL, \`name\` varchar(255) NULL, \`notes\` varchar(255) NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), UNIQUE INDEX \`IDX_7c51e7816439f36b64bf54e2ac\` (\`tenantId\`, \`phone\`), INDEX \`IDX_78708145905b919ba16977437b\` (\`tenantId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`appointments\` (\`id\` varchar(36) NOT NULL, \`tenantId\` varchar(255) NOT NULL, \`clientId\` varchar(255) NOT NULL, \`startTime\` timestamp NOT NULL, \`endTime\` timestamp NOT NULL, \`status\` enum ('pending', 'booked', 'confirmed', 'cancelled', 'completed') NOT NULL DEFAULT 'pending', \`googleEventId\` varchar(255) NULL, \`reminderSent\` tinyint NOT NULL DEFAULT 0, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX \`IDX_b03dc63f0b297fa136e97bf2dd\` (\`tenantId\`, \`status\`, \`startTime\`), INDEX \`IDX_72ae5ee60eb5ffa4388f9d3e07\` (\`tenantId\`, \`startTime\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`services\` (\`id\` varchar(36) NOT NULL, \`tenantId\` varchar(255) NOT NULL, \`name\` varchar(255) NOT NULL, \`description\` varchar(255) NULL, \`price\` decimal(10,2) NOT NULL, \`timezone\` varchar(255) NOT NULL, \`durationMinutes\` int NOT NULL, \`isActive\` tinyint NOT NULL DEFAULT 1, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`appointment_services\` (\`id\` varchar(36) NOT NULL, \`appointmentId\` varchar(255) NOT NULL, \`serviceId\` varchar(255) NOT NULL, \`staffId\` varchar(255) NOT NULL, \`startTime\` timestamp NOT NULL, \`endTime\` timestamp NOT NULL, \`activeStartTime\` timestamp NULL, \`priceAtBooking\` decimal(10,2) NOT NULL, \`durationAtBooking\` int NOT NULL, \`sequenceOrder\` int NULL, UNIQUE INDEX \`IDX_00b1b6248d9c6bb5299e8cadfd\` (\`staffId\`, \`activeStartTime\`), INDEX \`IDX_ae0e6592ef28db854f27bbc5c6\` (\`staffId\`, \`startTime\`, \`endTime\`), INDEX \`IDX_a22108074b9aa9651fe7d447e8\` (\`staffId\`, \`startTime\`), INDEX \`IDX_7c31247a60d6eddd6ce2c3f2f1\` (\`appointmentId\`, \`serviceId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`staff_schedules\` (\`id\` varchar(36) NOT NULL, \`staffId\` varchar(255) NOT NULL, \`dayOfWeek\` int NOT NULL, \`startTime\` time NOT NULL, \`endTime\` time NOT NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX \`IDX_2db063bdf547c2805a3f95953e\` (\`staffId\`, \`dayOfWeek\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`staff\` (\`id\` varchar(36) NOT NULL, \`tenantId\` varchar(255) NOT NULL, \`name\` varchar(255) NOT NULL, \`email\` varchar(255) NULL, \`calendarId\` varchar(255) NULL, \`isActive\` tinyint NOT NULL DEFAULT 1, \`usesCustomSchedule\` tinyint NOT NULL DEFAULT 0, \`commissionRate\` decimal(5,2) NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), \`deletedAt\` datetime(6) NULL, PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`business_hours\` (\`id\` varchar(36) NOT NULL, \`tenantId\` varchar(255) NOT NULL, \`dayOfWeek\` int NOT NULL, \`startTime\` time NOT NULL, \`endTime\` time NOT NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), INDEX \`IDX_9a47ac544d4307a3e6fdcc51e1\` (\`tenantId\`, \`dayOfWeek\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`tenants\` (\`id\` varchar(36) NOT NULL, \`name\` varchar(255) NOT NULL, \`businessType\` varchar(255) NULL, \`whatsappPhoneNumber\` varchar(255) NOT NULL, \`whatsappPhoneId\` text NULL, \`whatsappAccessToken\` text NULL, \`whatsappBusinessId\` text NULL, \`whatsappWabaId\` text NULL, \`whatsappVerifiedName\` text NULL, \`whatsappConnectedAt\` timestamp NULL, \`whatsappIsOnBusinessApp\` tinyint NOT NULL DEFAULT 0, \`whatsappPlatformType\` text NULL, \`timezone\` varchar(255) NOT NULL, \`currency\` varchar(3) NOT NULL DEFAULT 'BOB', \`email\` varchar(255) NULL, \`googleId\` varchar(255) NULL, \`status\` varchar(255) NOT NULL DEFAULT 'active', \`aiEnabled\` tinyint NOT NULL DEFAULT 1, \`googleRefreshToken\` varchar(255) NULL, \`googleAccessToken\` varchar(255) NULL, \`calendarId\` varchar(255) NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), UNIQUE INDEX \`IDX_6ac60c88d823a6883ef5f76918\` (\`whatsappPhoneNumber\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`booking_sessions\` (\`id\` varchar(36) NOT NULL, \`tenantId\` varchar(255) NOT NULL, \`clientId\` varchar(255) NOT NULL, \`conversationId\` varchar(255) NULL, \`token\` varchar(32) NOT NULL, \`state\` enum ('ASK_SERVICE', 'ASK_STAFF', 'ASK_SLOT', 'ASK_DATE', 'CONFIRM', 'COMPLETED', 'CANCELLED', 'EXPIRED') NOT NULL DEFAULT 'ASK_SERVICE', \`stepVersion\` int NOT NULL DEFAULT '0', \`selectedDate\` varchar(10) NULL, \`selectedServiceId\` varchar(36) NULL, \`staffPreference\` enum ('ANY', 'SPECIFIC') NULL, \`selectedStaffId\` varchar(36) NULL, \`selectedSlotStart\` datetime NULL, \`pageOffset\` int NOT NULL DEFAULT '0', \`appointmentId\` varchar(36) NULL, \`lastMetaMessageId\` varchar(128) NULL, \`expiresAt\` datetime NOT NULL, \`lastInteractionAt\` datetime NULL, \`closedReason\` varchar(64) NULL, \`closedAt\` datetime NULL, \`createdAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6), \`updatedAt\` datetime(6) NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), UNIQUE INDEX \`IDX_206e076a48e9ec48b94ced57da\` (\`token\`), INDEX \`IDX_650faea5562553325ee0a1386d\` (\`clientId\`, \`tenantId\`), PRIMARY KEY (\`id\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `CREATE TABLE \`staff_services\` (\`staffId\` varchar(36) NOT NULL, \`serviceId\` varchar(36) NOT NULL, INDEX \`IDX_536fadedfbced7381aa451a6cb\` (\`staffId\`), INDEX \`IDX_1c3f741478b75745b885c329b9\` (\`serviceId\`), PRIMARY KEY (\`staffId\`, \`serviceId\`)) ENGINE=InnoDB`,
    );
    await queryRunner.query(
      `ALTER TABLE \`messages\` ADD CONSTRAINT \`FK_809cf06e658568d5579aa335cb5\` FOREIGN KEY (\`tenantId\`) REFERENCES \`tenants\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`messages\` ADD CONSTRAINT \`FK_e5663ce0c730b2de83445e2fd19\` FOREIGN KEY (\`conversationId\`) REFERENCES \`conversations\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`messages\` ADD CONSTRAINT \`FK_0b420b51bc50f348cc866e95db9\` FOREIGN KEY (\`clientId\`) REFERENCES \`clients\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`conversations\` ADD CONSTRAINT \`FK_b4c6967d118be0f2483aee38047\` FOREIGN KEY (\`tenantId\`) REFERENCES \`tenants\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`conversations\` ADD CONSTRAINT \`FK_2882c536d4eecfd496132b20eeb\` FOREIGN KEY (\`clientId\`) REFERENCES \`clients\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`clients\` ADD CONSTRAINT \`FK_78708145905b919ba16977437b4\` FOREIGN KEY (\`tenantId\`) REFERENCES \`tenants\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`appointments\` ADD CONSTRAINT \`FK_46e6a4182e96de9d4c1bba50604\` FOREIGN KEY (\`tenantId\`) REFERENCES \`tenants\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`appointments\` ADD CONSTRAINT \`FK_c4dbd8eb292b83b5dc67be3cf45\` FOREIGN KEY (\`clientId\`) REFERENCES \`clients\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`services\` ADD CONSTRAINT \`FK_c61e3da9e437d4534faa63cf94a\` FOREIGN KEY (\`tenantId\`) REFERENCES \`tenants\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`appointment_services\` ADD CONSTRAINT \`FK_0d96cf6582c33fafac115779919\` FOREIGN KEY (\`appointmentId\`) REFERENCES \`appointments\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`appointment_services\` ADD CONSTRAINT \`FK_e6c70753e072adbd25ea521c890\` FOREIGN KEY (\`serviceId\`) REFERENCES \`services\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`appointment_services\` ADD CONSTRAINT \`FK_dd91fe733c668f8a2dbafa83c23\` FOREIGN KEY (\`staffId\`) REFERENCES \`staff\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`staff_schedules\` ADD CONSTRAINT \`FK_0fd8c4a28dbb3eb655071efd06d\` FOREIGN KEY (\`staffId\`) REFERENCES \`staff\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`staff\` ADD CONSTRAINT \`FK_c4f42a7776a2fd07edf070e3953\` FOREIGN KEY (\`tenantId\`) REFERENCES \`tenants\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`business_hours\` ADD CONSTRAINT \`FK_7d48dbbdd781adbbbb54d311e5b\` FOREIGN KEY (\`tenantId\`) REFERENCES \`tenants\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`booking_sessions\` ADD CONSTRAINT \`FK_16d60a303b979d1656b45068a32\` FOREIGN KEY (\`tenantId\`) REFERENCES \`tenants\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`booking_sessions\` ADD CONSTRAINT \`FK_b3083584b84babb92aa24cb1fc2\` FOREIGN KEY (\`clientId\`) REFERENCES \`clients\`(\`id\`) ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE \`staff_services\` ADD CONSTRAINT \`FK_536fadedfbced7381aa451a6cba\` FOREIGN KEY (\`staffId\`) REFERENCES \`staff\`(\`id\`) ON DELETE CASCADE ON UPDATE CASCADE`,
    );
    await queryRunner.query(
      `ALTER TABLE \`staff_services\` ADD CONSTRAINT \`FK_1c3f741478b75745b885c329b9c\` FOREIGN KEY (\`serviceId\`) REFERENCES \`services\`(\`id\`) ON DELETE NO ACTION ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`staff_services\` DROP FOREIGN KEY \`FK_1c3f741478b75745b885c329b9c\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`staff_services\` DROP FOREIGN KEY \`FK_536fadedfbced7381aa451a6cba\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`booking_sessions\` DROP FOREIGN KEY \`FK_b3083584b84babb92aa24cb1fc2\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`booking_sessions\` DROP FOREIGN KEY \`FK_16d60a303b979d1656b45068a32\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`business_hours\` DROP FOREIGN KEY \`FK_7d48dbbdd781adbbbb54d311e5b\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`staff\` DROP FOREIGN KEY \`FK_c4f42a7776a2fd07edf070e3953\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`staff_schedules\` DROP FOREIGN KEY \`FK_0fd8c4a28dbb3eb655071efd06d\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`appointment_services\` DROP FOREIGN KEY \`FK_dd91fe733c668f8a2dbafa83c23\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`appointment_services\` DROP FOREIGN KEY \`FK_e6c70753e072adbd25ea521c890\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`appointment_services\` DROP FOREIGN KEY \`FK_0d96cf6582c33fafac115779919\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`services\` DROP FOREIGN KEY \`FK_c61e3da9e437d4534faa63cf94a\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`appointments\` DROP FOREIGN KEY \`FK_c4dbd8eb292b83b5dc67be3cf45\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`appointments\` DROP FOREIGN KEY \`FK_46e6a4182e96de9d4c1bba50604\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`clients\` DROP FOREIGN KEY \`FK_78708145905b919ba16977437b4\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`conversations\` DROP FOREIGN KEY \`FK_2882c536d4eecfd496132b20eeb\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`conversations\` DROP FOREIGN KEY \`FK_b4c6967d118be0f2483aee38047\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`messages\` DROP FOREIGN KEY \`FK_0b420b51bc50f348cc866e95db9\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`messages\` DROP FOREIGN KEY \`FK_e5663ce0c730b2de83445e2fd19\``,
    );
    await queryRunner.query(
      `ALTER TABLE \`messages\` DROP FOREIGN KEY \`FK_809cf06e658568d5579aa335cb5\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_1c3f741478b75745b885c329b9\` ON \`staff_services\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_536fadedfbced7381aa451a6cb\` ON \`staff_services\``,
    );
    await queryRunner.query(`DROP TABLE \`staff_services\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_650faea5562553325ee0a1386d\` ON \`booking_sessions\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_206e076a48e9ec48b94ced57da\` ON \`booking_sessions\``,
    );
    await queryRunner.query(`DROP TABLE \`booking_sessions\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_6ac60c88d823a6883ef5f76918\` ON \`tenants\``,
    );
    await queryRunner.query(`DROP TABLE \`tenants\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_9a47ac544d4307a3e6fdcc51e1\` ON \`business_hours\``,
    );
    await queryRunner.query(`DROP TABLE \`business_hours\``);
    await queryRunner.query(`DROP TABLE \`staff\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_2db063bdf547c2805a3f95953e\` ON \`staff_schedules\``,
    );
    await queryRunner.query(`DROP TABLE \`staff_schedules\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_7c31247a60d6eddd6ce2c3f2f1\` ON \`appointment_services\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_a22108074b9aa9651fe7d447e8\` ON \`appointment_services\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_ae0e6592ef28db854f27bbc5c6\` ON \`appointment_services\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_00b1b6248d9c6bb5299e8cadfd\` ON \`appointment_services\``,
    );
    await queryRunner.query(`DROP TABLE \`appointment_services\``);
    await queryRunner.query(`DROP TABLE \`services\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_72ae5ee60eb5ffa4388f9d3e07\` ON \`appointments\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_b03dc63f0b297fa136e97bf2dd\` ON \`appointments\``,
    );
    await queryRunner.query(`DROP TABLE \`appointments\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_78708145905b919ba16977437b\` ON \`clients\``,
    );
    await queryRunner.query(
      `DROP INDEX \`IDX_7c51e7816439f36b64bf54e2ac\` ON \`clients\``,
    );
    await queryRunner.query(`DROP TABLE \`clients\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_165a87f59f19ac000f70cdcdab\` ON \`conversations\``,
    );
    await queryRunner.query(`DROP TABLE \`conversations\``);
    await queryRunner.query(
      `DROP INDEX \`IDX_751332fc6cc6fc576c6975cd07\` ON \`messages\``,
    );
    await queryRunner.query(`DROP TABLE \`messages\``);
  }
}
