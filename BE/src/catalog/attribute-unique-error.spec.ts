import { ConflictException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { rethrowAttributeUniqueError } from './attribute-unique-error.js';

describe('Attribute unique constraint mapping', () => {
  const error = (meta: Record<string, unknown>, code = 'P2002') =>
    new Prisma.PrismaClientKnownRequestError(
      'Internal SQL detail must not reach the response',
      { code, clientVersion: '7.10.0', meta },
    );
  it.each([
    [
      'attribute_definition_category_normalized_name_key',
      'ATTRIBUTE_NAME_CONFLICT',
    ],
    [
      'attribute_option_definition_normalized_value_key',
      'ATTRIBUTE_OPTION_VALUE_CONFLICT',
    ],
    ['category_attribute_definitions_categoryId_slug_key', 'SLUG_CONFLICT'],
    [
      'category_attribute_options_attributeDefinitionId_slug_key',
      'SLUG_CONFLICT',
    ],
  ])('maps driver constraint %s, without SQL details', (index, code) => {
    try {
      rethrowAttributeUniqueError(
        error({ driverAdapterError: { cause: { constraint: { index } } } }),
      );
    } catch (caught) {
      expect(caught).toBeInstanceOf(ConflictException);
      expect((caught as ConflictException).getResponse()).toEqual({
        statusCode: 409,
        code,
        message: code,
      });
    }
  });
  it.each([
    [
      'attribute_definition_category_normalized_name_key',
      'ATTRIBUTE_NAME_CONFLICT',
    ],
    [['categoryId', 'slug'], 'SLUG_CONFLICT'],
  ])('accepts the Prisma target representation %j', (target, code) => {
    expect(() => rethrowAttributeUniqueError(error({ target }))).toThrow(
      ConflictException,
    );
    try {
      rethrowAttributeUniqueError(error({ target }));
    } catch (caught) {
      expect((caught as ConflictException).getResponse()).toMatchObject({
        code,
      });
    }
  });
  it.each([
    error({ target: ['id'] }),
    error({ target: ['email'] }),
    error(
      { target: 'attribute_definition_category_normalized_name_key' },
      'P2010',
    ),
    new Error('attribute_definition_category_normalized_name_key'),
    {
      code: 'P2002',
      meta: { target: 'attribute_definition_category_normalized_name_key' },
    },
  ])(
    'rethrows unknown/unrelated faults by identity instead of inventing a business conflict',
    (unknown) => {
      try {
        rethrowAttributeUniqueError(unknown);
      } catch (caught) {
        expect(caught).toBe(unknown);
      }
    },
  );
});
