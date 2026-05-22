import {
  MigrationInterface,
  QueryRunner,
  Table,
  TableForeignKey,
  TableIndex,
} from 'typeorm';

export class CreateStaffServices1760000000000 implements MigrationInterface {
  name = 'CreateStaffServices1760000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.createTable(
      new Table({
        name: 'staff_services',
        columns: [
          { name: 'staffId', type: 'varchar', length: '36', isNullable: false },
          {
            name: 'serviceId',
            type: 'varchar',
            length: '36',
            isNullable: false,
          },
        ],
        uniques: [
          { name: 'UQ_staff_services', columnNames: ['staffId', 'serviceId'] },
        ],
      }),
      true,
    );

    await queryRunner.createIndex(
      'staff_services',
      new TableIndex({
        name: 'IDX_staff_services_staff',
        columnNames: ['staffId'],
      }),
    );
    await queryRunner.createIndex(
      'staff_services',
      new TableIndex({
        name: 'IDX_staff_services_service',
        columnNames: ['serviceId'],
      }),
    );

    await queryRunner.createForeignKey(
      'staff_services',
      new TableForeignKey({
        columnNames: ['staffId'],
        referencedTableName: 'staff',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );

    await queryRunner.createForeignKey(
      'staff_services',
      new TableForeignKey({
        columnNames: ['serviceId'],
        referencedTableName: 'services',
        referencedColumnNames: ['id'],
        onDelete: 'CASCADE',
      }),
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropTable('staff_services', true);
  }
}
