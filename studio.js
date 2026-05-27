const businessPages = [
  {
    title: "Get That Bod",
    eyebrow: "Body contouring",
    description: "Body contouring, EMS sculpting, fat cavitation, and radio frequency skin tightening.",
    buttonLabel: "Enter Get That Bod",
    href: "/get-that-bod"
  }
];

const cardGrid = document.querySelector("#studio-card-grid");

if (cardGrid) {
  cardGrid.replaceChildren(...businessPages.map((business) => {
    const card = document.createElement("article");
    card.className = "studio-card";

    const eyebrow = document.createElement("p");
    eyebrow.className = "studio-card__eyebrow";
    eyebrow.textContent = business.eyebrow;

    const title = document.createElement("h3");
    title.textContent = business.title;

    const description = document.createElement("p");
    description.textContent = business.description;

    const link = document.createElement("a");
    link.className = "button button-solid";
    link.href = business.href;
    link.textContent = business.buttonLabel;

    card.append(eyebrow, title, description, link);
    return card;
  }));
}
