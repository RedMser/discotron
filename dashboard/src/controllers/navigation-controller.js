window.Discotron.NavigationController = class {
	/**
	 * Load bot status and display it on top
	 */
	static displayBot() {
		Discotron.WebAPI.queryBot("discotron-dashboard", "get-bot-info").then((data) => {
			document.querySelector("#bot-info img").src = data.avatar;
			document.querySelector("#bot-info span").textContent = data.username;
		});
	}

	/**
	 * Display links in the "owner" section
	 */
	static displayOwnerSettings() {
		Discotron.WebAPI.queryBot("discotron-dashboard", "is-owner").then((data) => {
			if (data) {
				document.querySelectorAll(".bot-admin-link").forEach((element) => {
					element.style.display = "list-item";
				});
			}
		});
	}

	/**
	 * Display links in the "admin" section
	 */
	static displayServers() {
		Discotron.Guild.getAll().then((guilds) => {
			if (Object.keys(guilds).length > 0) {
				document.querySelector(".description").style.display = "none";

				let serverLinksContainer = document.querySelector("#nav-links ul");

				for (let i in guilds) {
					const guild = guilds[i];

					let template = guild.iconURL === null ?
						document.getElementById("template-server-acro") :
						document.getElementById("template-server-link");
					
					let serverLink = document.importNode(template.content, true);

					serverLink.querySelector(".server-link").href += guild.discordId;
					serverLink.querySelector(".server-link").innerHTML += guild.name;
					serverLink.querySelector(".server-link").title = guild.name;
					if (guild.iconURL === null) {
						// Use acronym
						// todo: measure width of acronym text, and specify inline-styled font-size in pixels of avg character size (so it fits no matter what)
						//	-> margin on the left = create an empty element before (same as my current ::before) and inline-style its width!
						serverLink.querySelector(".server-acro").textContent = guild.acronym;
					} else {
						// Use image
						serverLink.querySelector(".server-icon").src = guild.iconURL;
					}
					serverLinksContainer.appendChild(serverLink);
				}
			}
		});
	}

	/**
	 * Load user status and display it on top
	 */
	static displayUser() {
		document.querySelector("#user-info img").src = `https://cdn.discordapp.com/avatars/${localStorage.getItem("clientId")}/${localStorage.getItem("avatar")}.png`;
		document.querySelector("#user-info span").textContent = `${localStorage.getItem("username")}#${localStorage.getItem("discriminator")}`;
	}
};