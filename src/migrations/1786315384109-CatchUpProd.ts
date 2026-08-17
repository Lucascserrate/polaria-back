import { MigrationInterface, QueryRunner } from 'typeorm';

export class CatchUpProd1786315384109 implements MigrationInterface {
  name = 'CatchUpProd1786315384109';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX \`IDX_7c51e7816439f36b64bf54e2ac\` ON \`clients\``,
    );

    await queryRunner.query(
      `ALTER TABLE \`clients\` CHANGE \`phone\` \`phone\` varchar(255) NULL`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX \`IDX_7c51e7816439f36b64bf54e2ac\` ON \`clients\` (\`tenantId\`, \`phone\`)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX \`IDX_78708145905b919ba16977437b\` ON \`clients\``,
    );

    await queryRunner.query(
      `DROP INDEX \`IDX_7c51e7816439f36b64bf54e2ac\` ON \`clients\``,
    );

    await queryRunner.query(
      `ALTER TABLE \`clients\` CHANGE \`phone\` \`phone\` varchar(255) NOT NULL`,
    );

    await queryRunner.query(
      `CREATE UNIQUE INDEX \`IDX_7c51e7816439f36b64bf54e2ac\` ON \`clients\` (\`tenantId\`, \`phone\`)`,
    );
  }
}
