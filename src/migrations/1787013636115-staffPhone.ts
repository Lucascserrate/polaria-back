import { MigrationInterface, QueryRunner } from "typeorm";

export class StaffPhone1787013636115 implements MigrationInterface {
    name = 'StaffPhone1787013636115'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`staff\` ADD \`phone\` varchar(255) NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE \`staff\` DROP COLUMN \`phone\``);
    }

}
