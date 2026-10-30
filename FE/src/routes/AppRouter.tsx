import { Routes, Route } from "react-router-dom";
import { PublicLayout } from "../layouts/PublicLayout";
import { HomePage } from "../pages/HomePage";
import { ImageSearchPage } from "../pages/ImageSearchPage";
import { LoginPage } from "../pages/LoginPage";
import { RegisterPage } from "../pages/RegisterPage";
import { AccountPage } from "../pages/AccountPage";
import { PublicStorePage } from '../features/public-store/PublicStorePage';
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
import { SellerClosePage } from '../features/order-recovery/SellerClosePage';
import { ChatPage } from '../features/chat/ChatPage';
import { AftersalesPage } from '../features/aftersales/AftersalesPage';
import { StoreApplicationPage } from '../features/seller-onboarding/StoreApplicationPage';
import { ReviewPage } from '../features/product-reviews/ReviewPage';
import { NotificationsPage } from '../features/notifications/NotificationsPage';
import { ForgotPasswordPage, EmailConfirmationPage } from '../features/auth-email/EmailRecoveryPages';

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
        {import.meta.env.VITE_CHAT_ENABLED === 'true' && <Route path="/messages/:conversationId?" element={<ProtectedRoute allowedRoles={['USER','SELLER']}><ChatPage /></ProtectedRoute>} />}
        {/* Public Routes */}
        <Route path="/" element={<HomePage />} />
        {import.meta.env.VITE_IMAGE_SEARCH_ENABLED === 'true' && <Route path="/search/image" element={<ImageSearchPage />} />}
        <Route path="/login" element={<LoginPage />} />
        <Route path="/register" element={<RegisterPage />} />
        {import.meta.env.VITE_AUTH_EMAIL_ENABLED === 'true' && <>
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<EmailConfirmationPage reset />} />
          <Route path="/verify-email" element={<EmailConfirmationPage />} />
        </>}
        <Route path="/products/:id" element={<ProductDetailPage />} />
        <Route path="/stores/:storeId" element={<PublicStorePage />} />

        {/* Protected Routes - Any logged in user */}
        <Route
          path="/account"
          element={
            <ProtectedRoute>
              <AccountPage />
            </ProtectedRoute>
          }
        />

        <Route path="/cart" element={<ProtectedRoute buyerAccess allowedRoles={['USER']}><CartPage /></ProtectedRoute>} />
        <Route path="/checkout" element={<ProtectedRoute buyerAccess allowedRoles={['USER']}><CheckoutPage /></ProtectedRoute>} />

        {/* Protected Routes - Buyer addresses */}
        <Route
          path="/account/addresses"
          element={
            <ProtectedRoute buyerAccess allowedRoles={['USER']}>
              <AddressBookPage />
            </ProtectedRoute>
          }
        />

        <Route path="/account/orders" element={<ProtectedRoute buyerAccess allowedRoles={['USER']}><OrderReadPage scope="buyer" /></ProtectedRoute>} />
        <Route path="/account/aftersales" element={<ProtectedRoute buyerAccess allowedRoles={['USER']}><AftersalesPage scope="BUYER" /></ProtectedRoute>} />
        <Route path="/account/store-application" element={<ProtectedRoute allowedRoles={['USER','SELLER']}><StoreApplicationPage /></ProtectedRoute>} />
        <Route path="/account/reviews" element={<ProtectedRoute buyerAccess allowedRoles={['USER']}><ReviewPage scope="BUYER" /></ProtectedRoute>} />
        <Route path="/account/notifications" element={<ProtectedRoute><NotificationsPage /></ProtectedRoute>} />
        <Route path="/seller/reviews" element={<ProtectedRoute allowedRoles={['SELLER']}><ReviewPage scope="SELLER" /></ProtectedRoute>} />
        <Route path="/seller/aftersales" element={<ProtectedRoute allowedRoles={['SELLER']}><AftersalesPage scope="SELLER" /></ProtectedRoute>} />
        <Route path="/account/orders/:orderId" element={<ProtectedRoute buyerAccess allowedRoles={['USER']}><OrderReadPage scope="buyer" detail /></ProtectedRoute>} />
        <Route path="/seller/orders" element={<ProtectedRoute allowedRoles={['SELLER']}><OrderReadPage scope="seller" /></ProtectedRoute>} />
        <Route path="/seller/orders/:orderId/close" element={<ProtectedRoute allowedRoles={['SELLER']}><SellerClosePage /></ProtectedRoute>} />
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
