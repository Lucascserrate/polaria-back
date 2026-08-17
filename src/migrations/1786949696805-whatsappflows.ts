import { MigrationInterface, QueryRunner } from 'typeorm';

export class Whatsappflows1786949696805 implements MigrationInterface {
  name = 'Whatsappflows1786949696805';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`tenants\` ADD \`whatsappFlowId\` text NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE \`tenants\` DROP COLUMN \`whatsappFlowId\``,
    );
  }
}
