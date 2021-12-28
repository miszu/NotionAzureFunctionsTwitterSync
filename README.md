# Typescript Azure Functions + Notion API + Twitter = a Notion page showing your Twitter activity from the last week (updated each night)

Check out the full article here - https://www.codingwithmiszu.com/2021/12/28/how-to-integrate-typescript-azure-functions-with-notion-api

# Set up

✅ Typescript, Node 14

✅ Azure Functions V4

✅ Notion API

✅ Twitter API v2

<img src="https://github.com/miszu/NotionAzureFunctionsTwitterSync/blob/main/diagram.png?raw=true" width="933" height="451"/>

## How to run

Before running, make sure to fill out all of the config values in local.settings.json. If in doubt, check out the full article.

```
npm install
npm start
```

Open the /setup link (the last command above will output it), then the bot should start responding.

## Notion page which will be created/updated
![Image](https://github.com/miszu/NotionAzureFunctionsTwitterSync/blob/main/notionpage.png?raw=true)
