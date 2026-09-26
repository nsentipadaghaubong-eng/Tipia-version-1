import ProductPage from "./pages/ProductPage";
import Dashboard from "./pages/Dashboard";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import ReceiveDelivery from "./pages/ReceiveDelivery";
import AppLayout from "./components/AppLayout";
import SalesPage from "./pages/SalesPage";

function App() {
    return (
        <BrowserRouter>
            <Routes>
                <Route element={<AppLayout />}>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                    <Route path="/dashboard" element={<Dashboard />} />
                    <Route path="/products" element={<ProductPage />} />
                    <Route
                        path="/receive-delivery"
                        element={<ReceiveDelivery />}
                    />
                    <Route
                        path="/sales-page"
                        element={<SalesPage />}
                    />
                </Route>
                
                
            </Routes>
        </BrowserRouter>
    );
}

export default App;