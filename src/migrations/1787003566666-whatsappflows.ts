import { MigrationInterface, QueryRunner } from 'typeorm';

export class Whatsappflows1787003566666 implements MigrationInterface {
  name = 'Whatsappflows1787003566666';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`booking_sessions\` ADD \`replacesAppointmentId\` varchar(36) NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`booking_sessions\` DROP COLUMN \`replacesAppointmentId\``,
    );
  }
}
