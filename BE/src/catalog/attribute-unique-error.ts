import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

/** Map only known uniqueness constraints, never guess from a raw SQL message. */
export function rethrowAttributeUniqueError(error: unknown): never {
  if (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    error.code === 'P2002'
  ) {
    const target = error.meta?.target;
    const driver = error.meta?.driverAdapterError as
      { cause?: { constraint?: { index?: unknown } } } | undefined;
    const names: unknown[] = [
      driver?.cause?.constraint?.index,
      ...(Array.isArray(target) ? target : [target]),
    ];
    let code: string | undefined;
    if (names.includes('attribute_definition_category_normalized_name_key'))
      code = 'ATTRIBUTE_NAME_CONFLICT';
    else if (names.includes('attribute_option_definition_normalized_value_key'))
      code = 'ATTRIBUTE_OPTION_VALUE_CONFLICT';
    else if (
      names.some(
        (name) =>
          name === 'slug' ||
          name === 'category_attribute_definitions_categoryId_slug_key' ||
          name === 'category_attribute_options_attributeDefinitionId_slug_key',
      )
    )
      code = 'SLUG_CONFLICT';
    if (code)
      throw new ConflictException({ statusCode: 409, code, message: code });
  }
  throw error;
}
