import { Outlet } from "react-router-dom";
import Sidebar from "./Sidebar";

const AppLayout = () => {
    return (
        <>
            <Sidebar />
            <Outlet />
        </>
    );
};

export default AppLayout;