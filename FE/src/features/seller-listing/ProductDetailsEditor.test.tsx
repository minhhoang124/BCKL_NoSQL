// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ProductDetailsEditor } from "./ProductDetailsEditor";
import { marketplaceApi } from "../../services/marketplaceApi";
import type { Product, AttributeDefinition } from "../../types/marketplace";
const product: Product = {
  id: 1,
  name: "Product",
  description: null,
  category: { id: 1, name: "Category", slug: "cat" },
  brand: null,
  images: [],
  variants: [],
  optionGroups: [],
};
const definition: AttributeDefinition = {
  id: 8,
  name: "Chất liệu",
  dataType: "SINGLE_SELECT",
  isRequired: true,
  allowsCustom: false,
  options: [{ id: 9, value: "Cotton" }],
};
const run = async (
  work: () => Promise<unknown>,
  _message: string,
  saved?: () => void,
) => {
  await work();
  saved?.();
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
it("refreshes the same field when a fresh server value changes for the same product", async () => {
  vi.spyOn(marketplaceApi, "categoryAttributes").mockResolvedValue({
    id: 1,
    attributeDefinitions: [
      {
        ...definition,
        options: [...definition.options, { id: 10, value: "Linen" }],
      },
    ],
  });
  const saved = (optionId: number) => [
    {
      attributeDefinitionId: 8,
      optionId,
      textValue: null,
      numberValue: null,
      booleanValue: null,
    },
  ];
  const view = render(
    <ProductDetailsEditor
      product={{ ...product, attributeValues: saved(9) }}
      busy={false}
      run={run}
    />,
  );
  expect(await screen.findByLabelText("Chất liệu")).toHaveValue("9");
  view.rerender(
    <ProductDetailsEditor
      product={{ ...product, attributeValues: saved(10) }}
      busy={false}
      run={run}
    />,
  );
  expect(screen.getByLabelText("Chất liệu")).toHaveValue("10");
});
it.each(["BOOLEAN", "NUMBER"] as const)(
  "keeps false/zero as a typed %s value rather than omitting it",
  async (dataType) => {
    vi.spyOn(marketplaceApi, "categoryAttributes").mockResolvedValue({
      id: 1,
      attributeDefinitions: [{ ...definition, dataType, options: [] }],
    });
    const save = vi
      .spyOn(marketplaceApi, "saveAttribute")
      .mockResolvedValue({});
    render(<ProductDetailsEditor product={product} busy={false} run={run} />);
    fireEvent.change(await screen.findByLabelText("Chất liệu"), {
      target: { value: dataType === "BOOLEAN" ? "false" : "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Lưu Chất liệu" }));
    await waitFor(() =>
      expect(save).toHaveBeenCalledWith(
        1,
        8,
        dataType === "BOOLEAN" ? { booleanValue: false } : { numberValue: "0" },
      ),
    );
  },
);
it("uses SINGLE_SELECT contract and sends only the selected definition option", async () => {
  vi.spyOn(marketplaceApi, "categoryAttributes").mockResolvedValue({
    id: 1,
    attributeDefinitions: [definition],
  });
  const save = vi.spyOn(marketplaceApi, "saveAttribute").mockResolvedValue({});
  render(<ProductDetailsEditor product={product} busy={false} run={run} />);
  fireEvent.change(await screen.findByLabelText("Chất liệu"), {
    target: { value: "9" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Lưu Chất liệu" }));
  await waitFor(() => expect(save).toHaveBeenCalledWith(1, 8, { optionId: 9 }));
});
it("hides the previous category while loading and ignores a late schema from another product", async () => {
  let resolve!: (value: {
    id: number;
    attributeDefinitions: AttributeDefinition[];
  }) => void;
  vi.spyOn(marketplaceApi, "categoryAttributes")
    .mockReturnValueOnce(
      new Promise((done) => {
        resolve = done;
      }),
    )
    .mockResolvedValueOnce({ id: 2, attributeDefinitions: [] });
  const view = render(
    <ProductDetailsEditor key={1} product={product} busy={false} run={run} />,
  );
  view.rerender(
    <ProductDetailsEditor
      key={2}
      product={{ ...product, id: 2, category: { ...product.category, id: 2 } }}
      busy={false}
      run={run}
    />,
  );
  await screen.findByText("Danh mục này chưa có thuộc tính cần nhập.");
  await act(async () => resolve({ id: 1, attributeDefinitions: [definition] }));
  expect(screen.queryByLabelText("Chất liệu")).not.toBeInTheDocument();
});
it("blocks a duplicate signature while retaining each SKU price and stock", async () => {
  vi.spyOn(marketplaceApi, "categoryAttributes").mockResolvedValue({
    id: 1,
    attributeDefinitions: [],
  });
  const create = vi.spyOn(marketplaceApi, "addVariant");
  render(
    <ProductDetailsEditor
      product={{
        ...product,
        optionGroups: [
          {
            id: 2,
            name: "Màu",
            position: 0,
            values: [{ id: 10, value: "Đen", position: 0 }],
          },
        ],
        variants: [{ id: 20, price: "25000", stock: 7, optionSignature: "10" }],
      }}
      busy={false}
      run={run}
    />,
  );
  await screen.findByText("Danh mục này chưa có thuộc tính cần nhập.");
  fireEvent.change(screen.getByLabelText("Màu cho SKU"), {
    target: { value: "10" },
  });
  expect(screen.getByRole("button", { name: "Thêm phiên bản" })).toBeDisabled();
  expect(screen.getByRole("table")).toHaveTextContent("25.000");
  expect(create).not.toHaveBeenCalled();
});
