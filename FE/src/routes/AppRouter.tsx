import { Routes, Route } from 'react-router-dom';
import { PublicLayout } from '../layouts/PublicLayout';
import { HomePage } from '../pages/HomePage';
import { LoginPage } from '../pages/LoginPage';
import { RegisterPage } from '../pages/RegisterPage';
import { AccountPage } from '../pages/AccountPage';
import { CartPage } from '../pages/CartPage';
import { AddressBookPage } from '../pages/AddressBookPage';
import { ProductDetailPage } from '../pages/ProductDetailPage';
import { SellerDashboardPage } from '../pages/SellerDashboardPage';
import { AdminDashboardPage } from '../pages/AdminDashboardPage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { ProtectedRoute } from './ProtectedRoute';
import { CheckoutPage } from '../features/order-flow/CheckoutPage';
import { OrderReadPage } from '../features/order-readiness/OrderReadPages';

export function AppRouter() {
  return (
    <Routes>
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
            <ProtectedRoute allowedRoles={['SELLER']}>
              <SellerDashboardPage />
            </ProtectedRoute>
          }
        />

        {/* Protected Routes - Admin only */}
        <Route
          path="/admin/*"
          element={
            <ProtectedRoute allowedRoles={['ADMIN']}>
              <AdminDashboardPage />
            </ProtectedRoute>
          }
        />

        {/* Catch All */}
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}
