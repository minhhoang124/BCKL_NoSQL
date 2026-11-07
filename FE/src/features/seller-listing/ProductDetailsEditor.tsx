import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { marketplaceApi, formatPrice } from "../../services/marketplaceApi";
import type {
  AttributeDefinition,
  AttributeInput,
  Product,
  ProductAttributeValue,
} from "../../types/marketplace";
import styles from "../../pages/Marketplace.module.css";
import { VariantInventoryEditor } from "./VariantInventoryEditor";

type Run = (
  work: () => Promise<unknown>,
  success: string,
  onSaved?: () => void,
) => Promise<void>;
export function ProductDetailsEditor({
  product,
  busy,
  run,
  onInventoryChanged,
}: {
  product: Product;
  busy: boolean;
  run: Run;
  onInventoryChanged?: (product: Product) => void;
}) {
  const [definitions, setDefinitions] = useState<AttributeDefinition[]>([]);
  const [metadataCategory, setMetadataCategory] = useState<number | null>(null);
  const [attributeState, setAttributeState] = useState<
    "loading" | "ready" | "error"
  >("loading");
  const [reload, setReload] = useState(0);
  const [choices, setChoices] = useState<Record<number, string>>({});
  const groups = product.optionGroups ?? [];
  const editable =
    product.moderationStatus !== "PENDING" &&
    product.moderationStatus !== "FROZEN";
  useEffect(() => {
    let current = true;
    void marketplaceApi
      .categoryAttributes(product.category.id)
      .then((value) => {
        if (current) {
          setDefinitions(value.attributeDefinitions);
          setMetadataCategory(product.category.id);
          setAttributeState("ready");
        }
      })
      .catch(() => {
        if (current) {
          setMetadataCategory(product.category.id);
          setAttributeState("error");
        }
      });
    return () => {
      current = false;
    };
  }, [product.category.id, reload]);
  const ids = groups.map((g) => Number(choices[g.id]));
  const complete = ids.every((id) => Number.isSafeInteger(id) && id > 0);
  const signature = ids.length
    ? [...ids].sort((a, b) => a - b).join(":")
    : "default";
  const duplicate =
    complete &&
    product.variants.some(
      (v) =>
        v.optionSignature === signature ||
        (!groups.length && !v.optionSignature),
    );
  const schemaState =
    metadataCategory === product.category.id ? attributeState : "loading";
  function group(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget,
      data = new FormData(form);
    void run(
      () =>
        marketplaceApi.addOptionGroup(product.id, {
          name: String(data.get("groupName")).trim(),
          position: groups.length,
        }),
      "Đã thêm nhóm phân loại.",
      () => form.reset(),
    );
  }
  function variant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!complete || duplicate || !editable) return;
    const form = event.currentTarget,
      data = new FormData(form);
    void run(
      () =>
        marketplaceApi.addVariant(product.id, {
          price: String(data.get("price")),
          stock: Number(data.get("stock")),
          sellerSku: String(data.get("sellerSku") || "").trim() || null,
          optionValueIds: ids,
        }),
      "Đã thêm phiên bản bán.",
      () => form.reset(),
    );
  }
  return (
    <section className={`${styles.form} ${styles.scEditor}`} aria-label="Thuộc tính và phiên bản bán">
      {import.meta.env.VITE_SELLER_VARIANT_INVENTORY_ENABLED === "true" && product.variants.length > 0 && <VariantInventoryEditor product={product} busy={busy} onChanged={onInventoryChanged} />}
      {!editable && (
        <p role="status">
          Sản phẩm đang chờ duyệt hoặc bị đóng băng. Các trường chỉ đọc.
        </p>
      )}
      <div className={styles.editorGrid}>
      <div className={styles.editorCol}>
      <h2>Thuộc tính danh mục</h2>
      {schemaState === "loading" ? (
        <p>Đang tải thuộc tính…</p>
      ) : schemaState === "error" ? (
        <p role="alert">
          Không tải được thuộc tính. Hãy tải lại trước khi gửi duyệt.
        </p>
      ) : definitions.length ? (
        definitions.map((d) => (
          <AttributeField
            key={`${product.id}:${d.id}:${d.dataType}:${d.allowsCustom}:${d.options.map((o) => o.id).join(",")}:${JSON.stringify(product.attributeValues?.find((v) => v.attributeDefinitionId === d.id) ?? null)}`}
            productId={product.id}
            definition={d}
            saved={product.attributeValues?.find(
              (v) => v.attributeDefinitionId === d.id,
            )}
            disabled={busy || !editable}
            run={run}
          />
        ))
      ) : (
        <p>Danh mục này chưa có thuộc tính cần nhập.</p>
      )}
      <button
        type="button"
        className={styles.secondary}
        disabled={busy}
        onClick={() => {
          setAttributeState("loading");
          setReload((v) => v + 1);
        }}
      >
        Tải lại thuộc tính
      </button>
      <h2>Phân loại sản phẩm</h2>
      <p className={styles.scRowNote}>
        Tối đa hai nhóm (ví dụ Màu sắc, Kích thước), khai báo trước khi tạo SKU
        đầu tiên. Mỗi SKU chọn một giá trị của từng nhóm.
      </p>
      <form onSubmit={group} aria-label="Thêm nhóm phân loại">
        <fieldset
          disabled={
            busy ||
            !editable ||
            groups.length >= 2 ||
            product.variants.length > 0
          }
        >
          <label>
            Tên nhóm phân loại
            <input name="groupName" required maxLength={80} />
          </label>
          <button className={styles.secondary}>Thêm nhóm phân loại</button>
        </fieldset>
      </form>
      {product.variants.length > 0 && (
        <p>
          Đã có SKU: giữ nguyên nhóm phân loại, có thể thêm giá trị vào nhóm
          hiện có.
        </p>
      )}
      {groups.map((g) => (
        <form
          key={g.id}
          aria-label={`Giá trị ${g.name}`}
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget,
              data = new FormData(form);
            void run(
              () =>
                marketplaceApi.addOptionValue(product.id, g.id, {
                  value: String(data.get("value")).trim(),
                  position: g.values.length,
                }),
              "Đã thêm giá trị phân loại.",
              () => form.reset(),
            );
          }}
        >
          <fieldset disabled={busy || !editable}>
            <legend>{g.name}</legend>
            {g.values.length ? (
              <ul className={styles.scChips} aria-label={`Giá trị của ${g.name}`}>
                {g.values.map((v) => <li key={v.id}>{v.value}</li>)}
              </ul>
            ) : (
              <p className={styles.scRowNote}>Chưa có giá trị.</p>
            )}
            <label>
              Giá trị mới cho {g.name}
              <input name="value" required maxLength={120} />
            </label>
            <button className={styles.secondary}>Thêm giá trị {g.name}</button>
          </fieldset>
        </form>
      ))}
      </div>
      <div className={styles.editorCol}>
      <form
        className={styles.form}
        onSubmit={variant}
        aria-label="Thêm phiên bản bán"
      >
        <h2>Phiên bản bán</h2>
        <fieldset disabled={busy || !editable}>
          {groups.map((g) => (
            <label key={g.id}>
              {g.name} cho SKU
              <select
                aria-label={`${g.name} cho SKU`}
                required
                value={choices[g.id] ?? ""}
                onChange={(e) =>
                  setChoices((old) => ({ ...old, [g.id]: e.target.value }))
                }
              >
                <option value="">Chọn {g.name}</option>
                {g.values.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.value}
                  </option>
                ))}
              </select>
            </label>
          ))}
          {!groups.length && (
            <p>Không phân loại: tạo một SKU mặc định cho sản phẩm.</p>
          )}
          <label>
            Giá bán (VND)
            <input
              name="price"
              inputMode="decimal"
              placeholder="Giá, ví dụ 199000"
              pattern="[0-9]+([.][0-9]{1,2})?"
              required
            />
          </label>
          <label>
            Tồn kho SKU
            <input
              name="stock"
              type="number"
              min="0"
              max="2147483647"
              step="1"
              placeholder="Tồn kho"
              required
            />
          </label>
          <label>
            Mã Seller SKU
            <input
              name="sellerSku"
              maxLength={80}
              placeholder="Mã Seller (tùy chọn)"
            />
          </label>
          {duplicate && (
            <p role="status">Tổ hợp này đã có SKU. Hãy chọn tổ hợp khác.</p>
          )}
          <button className={styles.scPrimary} disabled={busy || duplicate || !complete}>
            Thêm phiên bản
          </button>
        </fieldset>
      </form>
      {product.variants.length > 0 && (
        <div
          className={styles.skuTable}
          tabIndex={0}
          role="region"
          aria-label="Bảng SKU, có thể cuộn ngang"
        >
          <table>
            <caption>Giá và tồn kho theo SKU</caption>
            <thead>
              <tr>
                <th scope="col">Phân loại</th>
                <th scope="col">Mã Seller SKU</th>
                <th scope="col">Giá</th>
                <th scope="col">Tồn kho</th>
              </tr>
            </thead>
            <tbody>
              {product.variants.map((v) => {
                const values = new Set(
                  v.optionSignature?.split(":").map(Number),
                );
                const label =
                  groups
                    .flatMap((g) =>
                      g.values
                        .filter((x) => values.has(x.id))
                        .map((x) => `${g.name}: ${x.value}`),
                    )
                    .join(" / ") || "Mặc định";
                return (
                  <tr key={v.id}>
                    <th scope="row">{label}</th>
                    <td>
                      {v.sellerSku || "—"}
                      {v.skuCode && <small className={styles.scSkuCode} title={v.skuCode}>{v.skuCode}</small>}
                    </td>
                    <td>{formatPrice(v.price)}</td>
                    <td>{v.stock ?? "Chưa xác định"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      </div>
      </div>
    </section>
  );
}

function AttributeField({
  productId,
  definition: d,
  saved,
  disabled,
  run,
}: {
  productId: number;
  definition: AttributeDefinition;
  saved?: ProductAttributeValue;
  disabled: boolean;
  run: Run;
}) {
  const [value, setValue] = useState(
    saved?.optionId
      ? String(saved.optionId)
      : d.dataType === "SINGLE_SELECT" && saved?.textValue
        ? "custom"
        : d.dataType === "BOOLEAN"
          ? saved?.booleanValue == null
            ? ""
            : String(saved.booleanValue)
          : (saved?.textValue ?? saved?.numberValue ?? ""),
  );
  const [custom, setCustom] = useState(saved?.textValue ?? "");
  const [localError, setLocalError] = useState("");
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    setLocalError("");
    let input: AttributeInput;
    if (d.dataType === "SINGLE_SELECT") {
      if (value === "custom" && !custom.trim()) {
        setLocalError(`Nhập giá trị khác cho ${d.name}.`);
        return;
      }
      input =
        value === "custom"
          ? { textValue: custom.trim() }
          : { optionId: Number(value) };
    } else if (d.dataType === "BOOLEAN")
      input = { booleanValue: value === "true" };
    else if (d.dataType === "NUMBER") {
      // Accept a Vietnamese decimal comma; the API expects a plain number string.
      const normalized = String(value).trim().replace(",", ".");
      // Same shape as the API's IsNumberString: optional sign, optional leading digits before '.'.
      if (!/^[+-]?(\d*\.)?\d+$/.test(normalized)) {
        setLocalError(`${d.name} cần là số, ví dụ 6.5.`);
        return;
      }
      input = { numberValue: normalized };
    } else {
      if (!String(value).trim()) {
        setLocalError(`${d.name} không được để trống.`);
        return;
      }
      input = { textValue: String(value).trim() };
    }
    void run(
      () => marketplaceApi.saveAttribute(productId, d.id, input),
      `Đã lưu thuộc tính ${d.name}.`,
    );
  }
  return (
    <form onSubmit={save} aria-label={`Thuộc tính ${d.name}`}>
      <fieldset disabled={disabled}>
        <legend>
          {d.name}
          {d.isRequired ? " (bắt buộc)" : ""}
        </legend>
        {d.dataType === "SINGLE_SELECT" ? (
          <>
            <label>
              {d.name}
              <select
                aria-label={d.name}
                required
                value={value}
                onChange={(e) => setValue(e.target.value)}
              >
                <option value="">Chọn giá trị</option>
                {d.options.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.value}
                  </option>
                ))}
                {d.allowsCustom && (
                  <option value="custom">Nhập giá trị khác</option>
                )}
              </select>
            </label>
            {value === "custom" && (
              <label>
                Giá trị khác cho {d.name}
                <input
                  required
                  maxLength={2000}
                  value={custom}
                  onChange={(e) => setCustom(e.target.value)}
                />
              </label>
            )}
          </>
        ) : d.dataType === "BOOLEAN" ? (
          <label>
            {d.name}
            <select
              aria-label={d.name}
              required
              value={value}
              onChange={(e) => setValue(e.target.value)}
            >
              <option value="">Chọn giá trị</option>
              <option value="true">Có</option>
              <option value="false">Không</option>
            </select>
          </label>
        ) : (
          <label>
            {d.name}
            <input
              required
              maxLength={2000}
              inputMode={d.dataType === "NUMBER" ? "decimal" : "text"}
              value={value}
              onChange={(e) => setValue(e.target.value)}
            />
          </label>
        )}
        <button className={styles.secondary}>Lưu {d.name}</button>
        {localError && <p role="alert" className={styles.scFieldError}>{localError}</p>}
      </fieldset>
    </form>
  );
}
