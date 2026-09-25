import { BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

@Injectable()
export class ProductIdPipe implements PipeTransform<string, number> {
  transform(value: string): number {
    const id = Number(value);
    if (
      !/^\d+$/.test(value) ||
      !Number.isInteger(id) ||
      id < 1 ||
      id > 2147483647
    ) {
      throw new BadRequestException('productId phải là số nguyên dương hợp lệ');
    }
    return id;
  }
}
