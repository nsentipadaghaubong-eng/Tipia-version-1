import { Link } from "react-router-dom";

const Sidebar = () => {
    return (
        <>
        <Link to="/products">
            Products
        </Link>

        <Link to="/dashboard">
            Dashboard
        </Link>

        <Link to="/receive-delivery">
            Receive delivery
        </Link>
        <Link to="/sales-page">
            Sales Page
        </Link>
       </> 
    );
};

export default Sidebar