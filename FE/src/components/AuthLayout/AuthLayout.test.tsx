// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { AuthLayout } from "./AuthLayout";

afterEach(cleanup);
it("keeps form content and uses only decorative local artwork, not catalog images", () => {
  const { container } = render(
    <AuthLayout>
      <button>Đăng nhập</button>
    </AuthLayout>,
  );
  expect(screen.getByRole("button", { name: "Đăng nhập" })).toBeInTheDocument();
  const image = container.querySelector("img");
  expect(image).toHaveAttribute("src", "/images/auth-shopping-v1.webp");
  expect(image).toHaveAttribute("alt", "");
  expect(container.querySelector("a")).toBeNull();
});
