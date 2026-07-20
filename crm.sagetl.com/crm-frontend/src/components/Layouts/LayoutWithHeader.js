import React from "react";
import { Outlet } from "react-router-dom";
import Header from "../Header/Header";

function LayoutWithHeader() {
  return (
    <div>
      <Header />
      <main>
        <Outlet />
      </main>
    </div>
  );
}

export default LayoutWithHeader;
