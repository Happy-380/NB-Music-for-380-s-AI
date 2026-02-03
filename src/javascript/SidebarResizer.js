class SidebarResizer {
    /**
     * 侧栏宽度调整组件
     * 管理侧栏宽度的拖拽调整和状态保存
     * @param {import("./SettingManager.js")} settingManager
     */
    constructor(settingManager) {
        this.settingManager = settingManager;
        this.resizer = document.getElementById("sidebarResizer");
        this.sidebar = document.querySelector(".sidebar");
        this.mica = document.querySelector(".mica");
        this.isResizing = false;
        this.minWidth = 220;
        this.maxWidth = 400;
        this.defaultWidth = 260;

        // 恢复保存的侧栏宽度
        this.restoreSidebarWidth();

        // 初始化事件监听
        this.initEventListeners();
    }

    /**
     * 初始化事件监听
     */
    initEventListeners() {
        // 拖拽开始
        this.resizer.addEventListener("mousedown", (e) => {
            this.isResizing = true;
            document.body.classList.add("resizing");
            this.resizer.classList.add("active");

            // 记录初始位置
            this.startX = e.clientX;
            this.startWidth = this.sidebar.offsetWidth;

            // 阻止默认行为和冒泡
            e.preventDefault();
            e.stopPropagation();
        });

        // 拖拽过程
        document.addEventListener("mousemove", (e) => {
            if (!this.isResizing) return;

            const width = this.startWidth + (e.clientX - this.startX);
            const newWidth = Math.min(Math.max(width, this.minWidth), this.maxWidth);

            // 更新侧栏宽度
            document.documentElement.style.setProperty("--sidebar-width", `${newWidth}px`);

            // 更新拖拽条位置
            this.resizer.style.left = `${newWidth - 2}px`;
        });

        // 拖拽结束
        document.addEventListener("mouseup", () => {
            if (this.isResizing) {
                this.isResizing = false;
                document.body.classList.remove("resizing");
                this.resizer.classList.remove("active");

                // 保存当前宽度
                this.saveSidebarWidth();
            }
        });

        // 窗口大小改变时，确保拖拽条位置正确
        window.addEventListener("resize", () => {
            if (this.resizer && this.sidebar) {
                this.resizer.style.left = `${this.sidebar.offsetWidth - 2}px`;
            }
        });

        // 双击拖拽条恢复默认宽度
        this.resizer.addEventListener("dblclick", () => {
            document.documentElement.style.setProperty("--sidebar-width", `${this.defaultWidth}px`);
            this.resizer.style.left = `${this.defaultWidth - 2}px`;
            this.saveSidebarWidth();
        });
    }

    /**
     * 保存侧栏宽度设置
     */
    saveSidebarWidth() {
        const currentWidth = this.sidebar.offsetWidth;
        if (this.settingManager) {
            this.settingManager.setSetting("sidebarWidth", currentWidth);
        } else {
            localStorage.setItem("nbmusic_sidebar_width", currentWidth);
        }
    }

    /**
     * 恢复保存的侧栏宽度
     */
    restoreSidebarWidth() {
        let savedWidth;

        if (this.settingManager) {
            savedWidth = this.settingManager.getSetting("sidebarWidth");
        } else {
            savedWidth = localStorage.getItem("nbmusic_sidebar_width");
        }

        if (savedWidth) {
            const width = parseInt(savedWidth);
            if (!isNaN(width) && width >= this.minWidth && width <= this.maxWidth) {
                document.documentElement.style.setProperty("--sidebar-width", `${width}px`);
                if (this.resizer) {
                    this.resizer.style.left = `${width - 2}px`;
                }
            }
        }
    }
}

// 导出类
module.exports = SidebarResizer;
