// UI view models only: not Backend DTOs, not PostgreSQL IDs or API fixtures.
export type DemoState =
  | "ready"
  | "loading"
  | "error"
  | "empty"
  | "price-changed"
  | "stock-short"
  | "unknown";
export type DemoOrderStatus =
  "PENDING_CONFIRMATION" | "SHIPPING" | "COMPLETED" | "CANCELLED";
export interface DemoOrder {
  id: string;
  number: string;
  store: string;
  status: DemoOrderStatus;
  product: string;
  options: string;
  quantity: number;
  unitPrice: string;
  total: string;
  payment: "UNPAID" | "PAID" | "CANCELLED";
  timeline: readonly { title: string; at: string }[];
}
export const demoAddress = {
  recipient: "Người nhận mẫu",
  phone: "Số điện thoại minh họa",
  line: "Địa chỉ minh họa · Phường mẫu · Thành phố mẫu",
};
export const demoOrders: readonly DemoOrder[] = [
  {
    id: "demo-audio",
    number: "DEMO-AUDIO-001",
    store: "BCKL Audio · cửa hàng mẫu",
    status: "PENDING_CONFIRMATION",
    product: "Tai nghe không dây · sản phẩm mẫu",
    options: "Màu đen",
    quantity: 2,
    unitPrice: "1290000.00",
    total: "2580000.00",
    payment: "UNPAID",
    timeline: [
      {
        title: "Đơn mẫu được tạo, đang chờ người bán xác nhận",
        at: "09/10/2026 · 10:00",
      },
    ],
  },
  {
    id: "demo-home",
    number: "DEMO-HOME-002",
    store: "Góc Nhà · cửa hàng mẫu",
    status: "SHIPPING",
    product: "Đèn bàn LED · sản phẩm mẫu",
    options: "Trắng",
    quantity: 1,
    unitPrice: "459000.00",
    total: "459000.00",
    payment: "UNPAID",
    timeline: [
      { title: "Đang giao — vận chuyển mô phỏng", at: "09/10/2026 · 09:00" },
      { title: "Người bán bàn giao đơn đã đóng gói", at: "08/10/2026 · 15:00" },
      { title: "Người bán xác nhận đơn", at: "08/10/2026 · 11:00" },
      { title: "Đơn mẫu được tạo", at: "08/10/2026 · 10:00" },
    ],
  },
];
export const statusLabels: Record<DemoOrderStatus, string> = {
  PENDING_CONFIRMATION: "Chờ xác nhận",
  SHIPPING: "Đang giao",
  COMPLETED: "Hoàn thành",
  CANCELLED: "Đã hủy",
};
export function displayMoney(value: string): string {
  if (!/^(0|[1-9][0-9]*)\.00$/.test(value))
    throw new Error("Invalid whole-VND demo amount");
  return `${new Intl.NumberFormat("vi-VN").format(BigInt(value.slice(0, -3)))} đ`;
}
