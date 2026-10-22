import { Routes, Route } from "react-router-dom";
import { PublicLayout } from "../layouts/PublicLayout";
import { HomePage } from "../pages/HomePage";
import { LoginPage } from "../pages/LoginPage";
import { RegisterPage } from "../pages/RegisterPage";
import { AccountPage } from "../pages/AccountPage";
import { ProductDetailPage } from "../pages/ProductDetailPage";
import { SellerDashboardPage } from "../pages/SellerDashboardPage";
import { AdminDashboardPage } from "../pages/AdminDashboardPage";
import { NotFoundPage } from "../pages/NotFoundPage";
import { ProtectedRoute } from "./ProtectedRoute";
import { BuyerPreviewLayout } from "../features/buyer-preview/BuyerPreviewLayout";
import { SellerOrderPreviewLayout, SellerOrdersPreviewPage, SellerOrderDetailPreviewPage } from "../features/seller-order-preview/SellerOrderPreview";
import {
  CheckoutPreviewPage,
  CheckoutResultPreviewPage,
  BuyerOrdersPreviewPage,
  BuyerOrderDetailPreviewPage,
} from "../features/buyer-preview/BuyerPreviewPages";
import { CartPage } from '../pages/CartPage';
import { AddressBookPage } from '../pages/AddressBookPage';
import { CheckoutPage } from '../features/order-flow/CheckoutPage';
import { OrderReadPage } from '../features/order-readiness/OrderReadPages';

export function AppRouter() {
  return (
    <Routes>
      {import.meta.env.DEV && (
        <Route path="/dev/seller-orders" element={<SellerOrderPreviewLayout />}>
          <Route index element={<SellerOrdersPreviewPage />} />
          <Route path=":demoId" element={<SellerOrderDetailPreviewPage />} />
        </Route>
      )}
      {import.meta.env.DEV && (
        <Route path="/dev/buyer-flow" element={<BuyerPreviewLayout />}>
          <Route index element={<CheckoutPreviewPage />} />
          <Route path="checkout" element={<CheckoutPreviewPage />} />
          <Route path="result" element={<CheckoutResultPreviewPage />} />
          <Route path="orders" element={<BuyerOrdersPreviewPage />} />
          <Route
            path="orders/:demoId"
            element={<BuyerOrderDetailPreviewPage />}
          />
        </Route>
      )}
      {/* Admin has its own shell and does not use the public storefront layout. */}
      <Route
        path="/admin/*"
        element={
          <ProtectedRoute allowedRoles={['ADMIN']}>
            <AdminDashboardPage />
          </ProtectedRoute>
        }
      />

      <Route element={<PublicLayout />}>
        {/* Public Routes */}
        <Route path="/" element={<HomePage />} />
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        <Route path="/products/:id" element={<ProductDetailPage />} />

        {/* Protected Routes - Any logged in user */}
        <Route
          path="/account"
          element={
            <ProtectedRoute>
              <AccountPage />
            </ProtectedRoute>
          }
        />

        <Route path="/cart" element={<ProtectedRoute allowedRoles={['USER']}><CartPage /></ProtectedRoute>} />
        <Route path="/checkout" element={<ProtectedRoute allowedRoles={['USER']}><CheckoutPage /></ProtectedRoute>} />

        {/* Protected Routes - Buyer addresses */}
        <Route
          path="/account/addresses"
          element={
            <ProtectedRoute allowedRoles={['USER']}>
              <AddressBookPage />
            </ProtectedRoute>
          }
        />

        <Route path="/account/orders" element={<ProtectedRoute allowedRoles={['USER']}><OrderReadPage scope="buyer" /></ProtectedRoute>} />
        <Route path="/account/orders/:orderId" element={<ProtectedRoute allowedRoles={['USER']}><OrderReadPage scope="buyer" detail /></ProtectedRoute>} />
        <Route path="/seller/orders" element={<ProtectedRoute allowedRoles={['SELLER']}><OrderReadPage scope="seller" /></ProtectedRoute>} />
        <Route path="/seller/orders/:orderId" element={<ProtectedRoute allowedRoles={['SELLER']}><OrderReadPage scope="seller" detail /></ProtectedRoute>} />

        {/* Protected Routes - Seller only */}
        <Route
          path="/seller/*"
          element={
            <ProtectedRoute allowedRoles={["SELLER"]}>
              <SellerDashboardPage />
            </ProtectedRoute>
          }
        />

        {/* Catch All */}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
