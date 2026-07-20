import React from "react";
import { Outlet } from "react-router-dom";

function LayoutWithoutHeader() {
  return (
    <div>
      <main>
        <Outlet />
      </main>
    </div>
  );
}

export default LayoutWithoutHeader;
