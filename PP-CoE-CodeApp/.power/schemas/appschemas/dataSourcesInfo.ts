/*!
 * Copyright (C) Microsoft Corporation. All rights reserved.
 * This file is auto-generated. Do not modify it manually.
 * Changes to this file may be overwritten.
 */

export const dataSourcesInfo = {
  "aadusers": {
    "tableId": "",
    "version": "",
    "primaryKey": "aaduserid",
    "dataSourceType": "Dataverse",
    "apis": {}
  },
  "downloadfile_dataverse": {
    "tableId": "",
    "version": "",
    "primaryKey": "",
    "dataSourceType": "Connector",
    "apis": {
      "Run": {
        "path": "/{connectionId}/triggers/manual/run",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "input",
            "in": "body",
            "required": true,
            "type": "object"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "default": {
            "type": "object"
          }
        }
      }
    }
  },
  "listrows_dataverse": {
    "tableId": "",
    "version": "",
    "primaryKey": "",
    "dataSourceType": "Connector",
    "apis": {
      "Run": {
        "path": "/{connectionId}/triggers/manual/run",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "input",
            "in": "body",
            "required": true,
            "type": "object"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "default": {
            "type": "object"
          }
        }
      }
    }
  },
  "pplicensingapi_wrapper_flow": {
    "tableId": "",
    "version": "",
    "primaryKey": "",
    "dataSourceType": "Connector",
    "apis": {
      "Run": {
        "path": "/{connectionId}/triggers/manual/run",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "input",
            "in": "body",
            "required": true,
            "type": "object"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "default": {
            "type": "object"
          }
        }
      }
    }
  },
  "microsoftcopilotstudio": {
    "tableId": "",
    "version": "",
    "primaryKey": "",
    "dataSourceType": "Connector",
    "apis": {
      "ExecuteCopilotAsyncV2": {
        "path": "/{connectionId}/powervirtualagents/dataverse-backed/authenticated/bots/{Copilot}/proactivecopilot/executeAsyncV2",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "Copilot",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          },
          {
            "name": "x-ms-conversation-id",
            "in": "header",
            "required": false,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "201": {
            "type": "void"
          },
          "default": {
            "type": "object"
          }
        }
      },
      "ExecuteCopilotAsync": {
        "path": "/{connectionId}/powervirtualagents/dataverse-backed/authenticated/bots/{Copilot}/proactivecopilot/executeAsync",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "Copilot",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          },
          {
            "name": "x-ms-conversation-id",
            "in": "header",
            "required": false,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "ExecuteCopilot": {
        "path": "/{connectionId}/powervirtualagents/dataverse-backed/authenticated/bots/{Copilot}/proactivecopilot/execute",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "Copilot",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          },
          {
            "name": "x-ms-conversation-id",
            "in": "header",
            "required": false,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "ListCopilots": {
        "path": "/{connectionId}/powervirtualagents/dataverse-backed/copilots",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "ExecuteDataverseCopilotToStart": {
        "path": "/{connectionId}/powervirtualagents/dataverse-backed/authenticated/bots/{Copilot}/conversations/{ConversationId}",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "Copilot",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "ConversationId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          },
          {
            "name": "environmentId",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          }
        }
      },
      "ContinueExecuteDataverseCopilot": {
        "path": "/{connectionId}/powervirtualagents/dataverse-backed/authenticated/bots/{Copilot}/conversations/{ConversationId}/continue",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "Copilot",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "ConversationId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          },
          {
            "name": "environmentId",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          }
        }
      },
      "ExecuteFirstPartyCopilot": {
        "path": "/{connectionId}/powervirtualagents/prebuilt/authenticated/bots/{Copilot}/conversations/{ConversationId}/execute/trigger/{TriggerId}",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "Copilot",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "TriggerId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "ConversationId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          },
          {
            "name": "environmentId",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          }
        }
      },
      "ExecuteFirstPartyCopilotToStart": {
        "path": "/{connectionId}/powervirtualagents/prebuilt/authenticated/bots/{Copilot}/conversations/{ConversationId}",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "Copilot",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "ConversationId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          },
          {
            "name": "environmentId",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          }
        }
      },
      "ContinueExecuteFirstPartyCopilot": {
        "path": "/{connectionId}/powervirtualagents/prebuilt/authenticated/bots/{Copilot}/conversations/{ConversationId}/continue",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "Copilot",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "ConversationId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          },
          {
            "name": "environmentId",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          }
        }
      },
      "InvokeConnectorCallback": {
        "path": "/{connectionId}/powervirtualagents/bots/{Copilot}/channels/{channelId}/user-triggers/users/{userId}/triggers/{triggerId}",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "Copilot",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "channelId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "userId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "triggerId",
            "in": "path",
            "required": true,
            "type": "string",
            "format": "guid"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          },
          {
            "name": "conversationId",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          }
        }
      },
      "InvokeTriggerOnAgenticRuntime": {
        "path": "/{connectionId}/copilotstudio/agenticruntime/bots/{Copilot}/triggers/{triggerId}/invoke",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "Copilot",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "triggerId",
            "in": "path",
            "required": true,
            "type": "string",
            "format": "uuid"
          },
          {
            "name": "x-ms-cds-bot-id",
            "in": "header",
            "required": true,
            "type": "string",
            "format": "uuid"
          },
          {
            "name": "x-ms-workflow-resourcegroup-name",
            "in": "header",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-workflow-name",
            "in": "header",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-trigger-connection-mode",
            "in": "header",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-trigger-purpose",
            "in": "header",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-trigger-component-schema-name",
            "in": "header",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-trigger-component-version",
            "in": "header",
            "required": true,
            "type": "integer"
          },
          {
            "name": "x-ms-trigger-bot-version",
            "in": "header",
            "required": true,
            "type": "string"
          },
          {
            "name": "inputs",
            "in": "body",
            "required": false,
            "type": "object"
          },
          {
            "name": "conversationId",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "x-ms-pva-bot-id",
            "in": "header",
            "required": false,
            "type": "string",
            "format": "uuid"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          }
        }
      },
      "InvokeTrigger": {
        "path": "/{connectionId}/powervirtualagents/bots/{Copilot}/triggers/{triggerId}/invoke",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "Copilot",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "triggerId",
            "in": "path",
            "required": true,
            "type": "string",
            "format": "uuid"
          },
          {
            "name": "x-ms-cds-bot-id",
            "in": "header",
            "required": true,
            "type": "string",
            "format": "uuid"
          },
          {
            "name": "x-ms-workflow-resourcegroup-name",
            "in": "header",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-workflow-name",
            "in": "header",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-trigger-connection-mode",
            "in": "header",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-trigger-purpose",
            "in": "header",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-trigger-component-schema-name",
            "in": "header",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-trigger-component-version",
            "in": "header",
            "required": true,
            "type": "integer"
          },
          {
            "name": "x-ms-trigger-bot-version",
            "in": "header",
            "required": true,
            "type": "string"
          },
          {
            "name": "inputs",
            "in": "body",
            "required": false,
            "type": "object"
          },
          {
            "name": "conversationId",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "x-ms-pva-bot-id",
            "in": "header",
            "required": false,
            "type": "string",
            "format": "uuid"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          }
        }
      },
      "EvaluationTestStartNewConversation": {
        "path": "/{connectionId}/powervirtualagents/evaluation-test/authenticated/bots/{CdsBotId}/conversations",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "CdsBotId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          },
          {
            "name": "environmentId",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          }
        }
      },
      "EvaluationTestExecuteTurn": {
        "path": "/{connectionId}/powervirtualagents/evaluation-test/authenticated/bots/{CdsBotId}/conversations/{ConversationId}",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "CdsBotId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "ConversationId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          },
          {
            "name": "environmentId",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          }
        }
      },
      "EvaluationTestContinueTurn": {
        "path": "/{connectionId}/powervirtualagents/evaluation-test/authenticated/bots/{CdsBotId}/conversations/{ConversationId}/continue",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "CdsBotId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "ConversationId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          },
          {
            "name": "environmentId",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          }
        }
      },
      "EvaluationTestStartNewConversationOnAgenticRuntime": {
        "path": "/{connectionId}/copilotstudio/agenticruntime/evaluation-test/authenticated/bots/{CdsBotId}/conversations",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "CdsBotId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          },
          {
            "name": "environmentId",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          }
        }
      },
      "EvaluationTestExecuteTurnOnAgenticRuntime": {
        "path": "/{connectionId}/copilotstudio/agenticruntime/evaluation-test/authenticated/bots/{CdsBotId}/conversations/{ConversationId}",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "CdsBotId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "ConversationId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          },
          {
            "name": "environmentId",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          }
        }
      },
      "EvaluationTestContinueTurnOnAgenticRuntime": {
        "path": "/{connectionId}/copilotstudio/agenticruntime/evaluation-test/authenticated/bots/{CdsBotId}/conversations/{ConversationId}/continue",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "CdsBotId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "ConversationId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          },
          {
            "name": "environmentId",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          }
        }
      },
      "DeclarativeAgentEvaluationTestStartNewConversation": {
        "path": "/{connectionId}/powervirtualagents/evaluation-test/authenticated/declarative-bots/{CdsBotId}/conversations",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "CdsBotId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          },
          {
            "name": "environmentId",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          }
        }
      },
      "DeclarativeAgentEvaluationTestExecuteTurn": {
        "path": "/{connectionId}/powervirtualagents/evaluation-test/authenticated/declarative-bots/{CdsBotId}/conversations/{ConversationId}",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "CdsBotId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "ConversationId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          },
          {
            "name": "environmentId",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          }
        }
      },
      "BindUserConnections": {
        "path": "/{connectionId}/powervirtualagents/bots/{botSchemaName}/channels/{channelId}/user-connections",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "botSchemaName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "channelId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "stateId",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          }
        ],
        "responseInfo": {
          "204": {
            "type": "void"
          }
        }
      },
      "RunAgentMakerEvaluationTestSet": {
        "path": "/{connectionId}/copilotstudio/bots/{Agent}/api/makerevaluation/testsets/{TestSetId}/run",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "Agent",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "TestSetId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": false,
            "type": "object"
          },
          {
            "name": "environmentId",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "202": {
            "type": "object"
          }
        }
      },
      "GetAgentMakerEvaluationTestSets": {
        "path": "/{connectionId}/copilotstudio/bots/{Agent}/api/makerevaluation/testsets",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "Agent",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "GetAgentMakerEvaluationTestSetDetails": {
        "path": "/{connectionId}/copilotstudio/bots/{Agent}/api/makerevaluation/testsets/{TestSetId}",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "Agent",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "TestSetId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "GetAgentMakerEvaluationTestRuns": {
        "path": "/{connectionId}/copilotstudio/bots/{Agent}/api/makerevaluation/testruns",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "Agent",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "GetAgentMakerEvaluationTestRunDetails": {
        "path": "/{connectionId}/copilotstudio/bots/{Agent}/api/makerevaluation/testruns/{EvaluationRunId}",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "Agent",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "EvaluationRunId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      }
    }
  },
  "powerplatformadminv2": {
    "tableId": "",
    "version": "",
    "primaryKey": "",
    "dataSourceType": "Connector",
    "apis": {
      "ExecuteRecommendationAction": {
        "path": "/{connectionId}/analytics/actions/{actionName}",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          },
          {
            "name": "actionName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "404": {
            "type": "void"
          }
        }
      },
      "GetRecommendations": {
        "path": "/{connectionId}/analytics/advisorRecommendations",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "$skipToken",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "404": {
            "type": "void"
          }
        }
      },
      "GetActionSchema": {
        "path": "/{connectionId}/analytics/advisorRecommendations/{scenario}/actionmetadata/{actionName}",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "scenario",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "actionName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "429": {
            "type": "void"
          }
        }
      },
      "GetScenarioActions": {
        "path": "/{connectionId}/analytics/advisorRecommendations/{scenario}/actions",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "scenario",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "array"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "429": {
            "type": "void"
          }
        }
      },
      "GetRecommendationResources": {
        "path": "/{connectionId}/analytics/advisorRecommendations/{scenario}/resources",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "scenario",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "$skipToken",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "429": {
            "type": "void"
          }
        }
      },
      "GetRecommendationScenarios": {
        "path": "/{connectionId}/analytics/advisorRecommendations/scenarios",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "x-ms-api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "array"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "404": {
            "type": "void"
          }
        }
      },
      "GetTenantApplicationPackage": {
        "path": "/{connectionId}/appmanagement/applicationPackages",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          }
        }
      },
      "GetEnvironmentApplicationPackage": {
        "path": "/{connectionId}/appmanagement/environments/{environmentId}/applicationPackages",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "appInstallState",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "lcid",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          }
        }
      },
      "InstallApplicationPackage": {
        "path": "/{connectionId}/appmanagement/environments/{environmentId}/applicationPackages/{uniqueName}/install",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "uniqueName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": false,
            "type": "object"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "202": {
            "type": "void"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          }
        }
      },
      "GetApplicationPackageInstallStatus": {
        "path": "/{connectionId}/appmanagement/environments/{environmentId}/operations/{operationId}",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "operationId",
            "in": "path",
            "required": true,
            "type": "string",
            "format": "uuid"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          }
        }
      },
      "ListEnvironmentGroupRoleAssignments": {
        "path": "/{connectionId}/authorization/environmentGroups/{environmentGroupId}/roleAssignments",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentGroupId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "CreateEnvironmentGroupRoleAssignment": {
        "path": "/{connectionId}/authorization/environmentGroups/{environmentGroupId}/roleAssignments",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentGroupId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          }
        ],
        "responseInfo": {
          "201": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "DeleteEnvironmentGroupRoleAssignment": {
        "path": "/{connectionId}/authorization/environmentGroups/{environmentGroupId}/roleAssignments/{roleAssignmentId}",
        "method": "DELETE",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentGroupId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "roleAssignmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "204": {
            "type": "void"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "ListEnvironmentRoleAssignments": {
        "path": "/{connectionId}/authorization/environments/{environmentId}/roleAssignments",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "CreateEnvironmentRoleAssignment": {
        "path": "/{connectionId}/authorization/environments/{environmentId}/roleAssignments",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          }
        ],
        "responseInfo": {
          "201": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "DeleteEnvironmentRoleAssignment": {
        "path": "/{connectionId}/authorization/environments/{environmentId}/roleAssignments/{roleAssignmentId}",
        "method": "DELETE",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "roleAssignmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "204": {
            "type": "void"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "ListRoleAssignments": {
        "path": "/{connectionId}/authorization/roleAssignments",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "CreateRoleAssignment": {
        "path": "/{connectionId}/authorization/roleAssignments",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          }
        ],
        "responseInfo": {
          "201": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "DeleteRoleAssignment": {
        "path": "/{connectionId}/authorization/roleAssignments/{roleAssignmentId}",
        "method": "DELETE",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "roleAssignmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "204": {
            "type": "void"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "ListRoleDefinitions": {
        "path": "/{connectionId}/authorization/roleDefinitions",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "ListConnections": {
        "path": "/{connectionId}/connectivity/environments/{environmentId}/connections",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "ListConnectors": {
        "path": "/{connectionId}/connectivity/environments/{environmentId}/connectors",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "$filter",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "GetConnectorById": {
        "path": "/{connectionId}/connectivity/environments/{environmentId}/connectors/{connectorId}",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "connectorId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "$filter",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "DeleteCopilotAgent": {
        "path": "/{connectionId}/copilotstudio/environments/{EnvironmentId}/bots/{BotId}/api/botAdminOperations",
        "method": "DELETE",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "EnvironmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "BotId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          }
        }
      },
      "ReassignCopilotAgent": {
        "path": "/{connectionId}/copilotstudio/environments/{EnvironmentId}/bots/{BotId}/api/botAdminOperations/reassign",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "EnvironmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "BotId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          }
        ],
        "responseInfo": {
          "204": {
            "type": "void"
          },
          "400": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "GetBotQuarantineStatus": {
        "path": "/{connectionId}/copilotstudio/environments/{EnvironmentId}/bots/{BotId}/api/botQuarantine",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "EnvironmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "BotId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "SetBotAsQuarantined": {
        "path": "/{connectionId}/copilotstudio/environments/{EnvironmentId}/bots/{BotId}/api/botQuarantine/SetAsQuarantined",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "EnvironmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "BotId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "SetBotAsUnquarantined": {
        "path": "/{connectionId}/copilotstudio/environments/{EnvironmentId}/bots/{BotId}/api/botQuarantine/SetAsUnquarantined",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "EnvironmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "BotId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "ListMakerEvaluationTestRuns": {
        "path": "/{connectionId}/copilotstudio/environments/{EnvironmentId}/bots/{BotId}/api/makerevaluation/testruns",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "EnvironmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "BotId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "GetMakerEvaluationTestRun": {
        "path": "/{connectionId}/copilotstudio/environments/{EnvironmentId}/bots/{BotId}/api/makerevaluation/testruns/{TestRunId}",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "EnvironmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "BotId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "TestRunId",
            "in": "path",
            "required": true,
            "type": "string",
            "format": "uuid"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "DownloadMakerEvaluationSnapshot": {
        "path": "/{connectionId}/copilotstudio/environments/{EnvironmentId}/bots/{BotId}/api/makerevaluation/testruns/{TestRunId}/snapshot",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "EnvironmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "BotId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "TestRunId",
            "in": "path",
            "required": true,
            "type": "string",
            "format": "uuid"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "string",
            "format": "binary"
          },
          "404": {
            "type": "void"
          }
        }
      },
      "ListMakerEvaluationTestSets": {
        "path": "/{connectionId}/copilotstudio/environments/{EnvironmentId}/bots/{BotId}/api/makerevaluation/testsets",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "EnvironmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "BotId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "GetMakerEvaluationTestSet": {
        "path": "/{connectionId}/copilotstudio/environments/{EnvironmentId}/bots/{BotId}/api/makerevaluation/testsets/{TestSetId}",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "EnvironmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "BotId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "TestSetId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "RunMakerEvaluationTestSet": {
        "path": "/{connectionId}/copilotstudio/environments/{EnvironmentId}/bots/{BotId}/api/makerevaluation/testsets/{TestSetId}/run",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "EnvironmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "BotId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "TestSetId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "GetFinOpsMaintenanceSettings": {
        "path": "/{connectionId}/dynamics/environments/{environmentId}/finopsadminsettings",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string",
            "format": "uuid"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "object"
          },
          "401": {
            "type": "object"
          },
          "403": {
            "type": "object"
          },
          "404": {
            "type": "object"
          },
          "500": {
            "type": "object"
          }
        }
      },
      "UpdateFinOpsMaintenanceSettings": {
        "path": "/{connectionId}/dynamics/environments/{environmentId}/finopsadminsettings",
        "method": "PUT",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string",
            "format": "uuid"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "object"
          },
          "401": {
            "type": "object"
          },
          "403": {
            "type": "object"
          },
          "404": {
            "type": "object"
          },
          "500": {
            "type": "object"
          }
        }
      },
      "CreateEnvironmentManagementSettings": {
        "path": "/{connectionId}/environmentmanagement/environments/{environmentId}/settings",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": false,
            "type": "object"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "object"
          },
          "409": {
            "type": "object"
          }
        }
      },
      "ListEnvironmentManagementSettings": {
        "path": "/{connectionId}/environmentmanagement/environments/{environmentId}/settings",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "$top",
            "in": "query",
            "required": false,
            "type": "integer"
          },
          {
            "name": "$select",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "object"
          },
          "404": {
            "type": "object"
          },
          "429": {
            "type": "object"
          }
        }
      },
      "UpdateEnvironmentManagementSettings": {
        "path": "/{connectionId}/environmentmanagement/environments/{environmentId}/settings",
        "method": "PATCH",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": false,
            "type": "object"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "404": {
            "type": "object"
          },
          "409": {
            "type": "object"
          },
          "412": {
            "type": "object"
          }
        }
      },
      "CreateEnvironmentBackup": {
        "path": "/{connectionId}/environmentmanagement/environments/{environmentId}/backups",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": false,
            "type": "object"
          }
        ],
        "responseInfo": {
          "201": {
            "type": "object"
          },
          "400": {
            "type": "object"
          }
        }
      },
      "GetEnvironmentBackups": {
        "path": "/{connectionId}/environmentmanagement/environments/{environmentId}/backups",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "object"
          },
          "404": {
            "type": "object"
          }
        }
      },
      "DeleteEnvironmentBackup": {
        "path": "/{connectionId}/environmentmanagement/environments/{environmentId}/backups/{backupId}",
        "method": "DELETE",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "backupId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "204": {
            "type": "void"
          },
          "400": {
            "type": "object"
          },
          "404": {
            "type": "void"
          }
        }
      },
      "GetBusinessContinuityStateFullSnapshot": {
        "path": "/{connectionId}/environmentmanagement/environments/{environmentId}/businessContinuityStateFullSnapshot",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "object"
          },
          "404": {
            "type": "object"
          }
        }
      },
      "DisableEnvironment": {
        "path": "/{connectionId}/environmentmanagement/environments/{environmentId}/Disable",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "ValidateOnly",
            "in": "query",
            "required": false,
            "type": "boolean"
          },
          {
            "name": "ValidateProperties",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": false,
            "type": "object"
          }
        ],
        "responseInfo": {
          "202": {
            "type": "void"
          },
          "400": {
            "type": "object"
          }
        }
      },
      "DisableDisasterRecovery": {
        "path": "/{connectionId}/environmentmanagement/environments/{environmentId}/disableDisasterRecovery",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "ValidateOnly",
            "in": "query",
            "required": false,
            "type": "boolean"
          },
          {
            "name": "ValidateProperties",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "201": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "409": {
            "type": "void"
          }
        }
      },
      "PerformDRDrill": {
        "path": "/{connectionId}/environmentmanagement/environments/{environmentId}/disasterRecoveryDrill",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "ValidateOnly",
            "in": "query",
            "required": false,
            "type": "boolean"
          },
          {
            "name": "ValidateProperties",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "201": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "409": {
            "type": "void"
          }
        }
      },
      "EnableEnvironment": {
        "path": "/{connectionId}/environmentmanagement/environments/{environmentId}/Enable",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "ValidateOnly",
            "in": "query",
            "required": false,
            "type": "boolean"
          },
          {
            "name": "ValidateProperties",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": false,
            "type": "object"
          }
        ],
        "responseInfo": {
          "202": {
            "type": "void"
          },
          "400": {
            "type": "object"
          }
        }
      },
      "EnableDisasterRecovery": {
        "path": "/{connectionId}/environmentmanagement/environments/{environmentId}/enableDisasterRecovery",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "ValidateOnly",
            "in": "query",
            "required": false,
            "type": "boolean"
          },
          {
            "name": "ValidateProperties",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "201": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "409": {
            "type": "void"
          }
        }
      },
      "PerformForceFailover": {
        "path": "/{connectionId}/environmentmanagement/environments/{environmentId}/forceFailover",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "ValidateOnly",
            "in": "query",
            "required": false,
            "type": "boolean"
          },
          {
            "name": "ValidateProperties",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": false,
            "type": "object"
          }
        ],
        "responseInfo": {
          "201": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "409": {
            "type": "void"
          }
        }
      },
      "DisableManagedEnvironment": {
        "path": "/{connectionId}/environmentmanagement/environments/{environmentId}/governancesetting/disablemanaged",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "ValidateOnly",
            "in": "query",
            "required": false,
            "type": "boolean"
          },
          {
            "name": "ValidateProperties",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "201": {
            "type": "object"
          },
          "400": {
            "type": "object"
          }
        }
      },
      "EnableManagedEnvironment": {
        "path": "/{connectionId}/environmentmanagement/environments/{environmentId}/governancesetting/enablemanaged",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "ValidateOnly",
            "in": "query",
            "required": false,
            "type": "boolean"
          },
          {
            "name": "ValidateProperties",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "201": {
            "type": "object"
          },
          "400": {
            "type": "object"
          }
        }
      },
      "ModifyEnvironmentSku": {
        "path": "/{connectionId}/environmentmanagement/environments/{environmentId}/modifySku",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "ValidateOnly",
            "in": "query",
            "required": false,
            "type": "boolean"
          },
          {
            "name": "ValidateProperties",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": false,
            "type": "object"
          }
        ],
        "responseInfo": {
          "201": {
            "type": "object"
          },
          "400": {
            "type": "object"
          }
        }
      },
      "GetOperationsForEnvironment": {
        "path": "/{connectionId}/environmentmanagement/environments/{environmentId}/operations",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "limit",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "continuationToken",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "object"
          },
          "404": {
            "type": "object"
          }
        }
      },
      "RecoverEnvironment": {
        "path": "/{connectionId}/environmentmanagement/environments/{environmentId}/recover",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "ValidateOnly",
            "in": "query",
            "required": false,
            "type": "boolean"
          },
          {
            "name": "ValidateProperties",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "202": {
            "type": "void"
          },
          "400": {
            "type": "object"
          }
        }
      },
      "GetEnvironmentCopyCandidates": {
        "path": "/{connectionId}/environmentmanagement/environments/{sourceEnvironmentId}/copyCandidates",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "sourceEnvironmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "ValidateOnly",
            "in": "query",
            "required": false,
            "type": "boolean"
          },
          {
            "name": "ValidateProperties",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "object"
          },
          "404": {
            "type": "object"
          }
        }
      },
      "GetRestoreCandidates": {
        "path": "/{connectionId}/environmentmanagement/environments/{sourceEnvironmentId}/restoreCandidates",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "sourceEnvironmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "ValidateOnly",
            "in": "query",
            "required": false,
            "type": "boolean"
          },
          {
            "name": "ValidateProperties",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "object"
          },
          "404": {
            "type": "object"
          }
        }
      },
      "CopyEnvironment": {
        "path": "/{connectionId}/environmentmanagement/environments/{targetEnvironmentId}/copy",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "targetEnvironmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "ValidateOnly",
            "in": "query",
            "required": false,
            "type": "boolean"
          },
          {
            "name": "ValidateProperties",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": false,
            "type": "object"
          }
        ],
        "responseInfo": {
          "202": {
            "type": "void"
          },
          "400": {
            "type": "object"
          }
        }
      },
      "RestoreEnvironment": {
        "path": "/{connectionId}/environmentmanagement/environments/{targetEnvironmentId}/Restore",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "targetEnvironmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "ValidateOnly",
            "in": "query",
            "required": false,
            "type": "boolean"
          },
          {
            "name": "ValidateProperties",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": false,
            "type": "object"
          }
        ],
        "responseInfo": {
          "202": {
            "type": "void"
          },
          "400": {
            "type": "object"
          }
        }
      },
      "GetOperationByID": {
        "path": "/{connectionId}/environmentmanagement/operations/{operationId}",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "operationId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "object"
          },
          "404": {
            "type": "object"
          }
        }
      },
      "ProvisionNewEnvironment": {
        "path": "/{connectionId}/environmentmanagement/provisioning/create",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": false,
            "type": "object"
          }
        ],
        "responseInfo": {
          "201": {
            "type": "object"
          },
          "202": {
            "type": "void"
          },
          "400": {
            "type": "object"
          }
        }
      },
      "LinkDataverse": {
        "path": "/{connectionId}/environmentmanagement/provisioning/environments/{environmentId}/link",
        "method": "PATCH",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": false,
            "type": "object"
          }
        ],
        "responseInfo": {
          "202": {
            "type": "object"
          },
          "400": {
            "type": "object"
          }
        }
      },
      "GetSupportedLocations": {
        "path": "/{connectionId}/environmentmanagement/provisioning/locations",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "object"
          },
          "404": {
            "type": "object"
          }
        }
      },
      "GetProvisioningCurrencies": {
        "path": "/{connectionId}/environmentmanagement/provisioning/locations/{location}/currencies",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "location",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "object"
          }
        }
      },
      "GetProvisioningLanguages": {
        "path": "/{connectionId}/environmentmanagement/provisioning/locations/{location}/languages",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "location",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "object"
          }
        }
      },
      "GetProvisioningTemplates": {
        "path": "/{connectionId}/environmentmanagement/provisioning/locations/{location}/templates",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "location",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "object"
          }
        }
      },
      "GetEnvironmentGroupOperation": {
        "path": "/{connectionId}/environmentmanagement/environmentGroupOperations/{operationId}",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "operationId",
            "in": "path",
            "required": true,
            "type": "string",
            "format": "uuid"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          },
          "204": {
            "type": "void"
          },
          "400": {
            "type": "object"
          }
        }
      },
      "CreateEnvironmentGroup": {
        "path": "/{connectionId}/environmentmanagement/environmentGroups",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "204": {
            "type": "void"
          },
          "400": {
            "type": "object"
          }
        }
      },
      "ListEnvironmentGroups": {
        "path": "/{connectionId}/environmentmanagement/environmentGroups",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "204": {
            "type": "void"
          },
          "400": {
            "type": "object"
          }
        }
      },
      "GetEnvironmentGroup": {
        "path": "/{connectionId}/environmentmanagement/environmentGroups/{groupId}",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "groupId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "204": {
            "type": "void"
          },
          "400": {
            "type": "object"
          }
        }
      },
      "UpdateEnvironmentGroup": {
        "path": "/{connectionId}/environmentmanagement/environmentGroups/{groupId}",
        "method": "PUT",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "groupId",
            "in": "path",
            "required": true,
            "type": "string",
            "format": "uuid"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "204": {
            "type": "void"
          },
          "400": {
            "type": "object"
          }
        }
      },
      "DeleteEnvironmentGroup": {
        "path": "/{connectionId}/environmentmanagement/environmentGroups/{groupId}",
        "method": "DELETE",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "groupId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          },
          "204": {
            "type": "void"
          },
          "400": {
            "type": "object"
          }
        }
      },
      "AddEnvironmentToGroup": {
        "path": "/{connectionId}/environmentmanagement/environmentGroups/{groupId}/addEnvironment/{environmentId}",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "groupId",
            "in": "path",
            "required": true,
            "type": "string",
            "format": "uuid"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "202": {
            "type": "void"
          },
          "204": {
            "type": "void"
          },
          "400": {
            "type": "object"
          }
        }
      },
      "RemoveEnvironmentFromGroup": {
        "path": "/{connectionId}/environmentmanagement/environmentGroups/{groupId}/removeEnvironment/{environmentId}",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "groupId",
            "in": "path",
            "required": true,
            "type": "string",
            "format": "uuid"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "202": {
            "type": "void"
          },
          "204": {
            "type": "void"
          },
          "400": {
            "type": "object"
          }
        }
      },
      "ListEnvironmentsForUser": {
        "path": "/{connectionId}/environmentmanagement/environments",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "ids",
            "in": "query",
            "required": false,
            "type": "array"
          },
          {
            "name": "$filter",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "$select",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "$top",
            "in": "query",
            "required": false,
            "type": "integer"
          },
          {
            "name": "$skip",
            "in": "query",
            "required": false,
            "type": "integer"
          },
          {
            "name": "$orderby",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "GetEnvironmentByIdForUser": {
        "path": "/{connectionId}/environmentmanagement/environments/{environmentId}",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "$select",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "DeleteEnvironmentByID": {
        "path": "/{connectionId}/environmentmanagement/environments/{environmentId}",
        "method": "DELETE",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "ValidateOnly",
            "in": "query",
            "required": false,
            "type": "boolean"
          },
          {
            "name": "ValidateProperties",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "202": {
            "type": "void"
          },
          "400": {
            "type": "object"
          },
          "404": {
            "type": "void"
          }
        }
      },
      "CreateRuleBasedPolicy": {
        "path": "/{connectionId}/governance/ruleBasedPolicies",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "ListRuleBasedPolicies": {
        "path": "/{connectionId}/governance/ruleBasedPolicies",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "GetRuleBasedPolicyByID": {
        "path": "/{connectionId}/governance/ruleBasedPolicies/{policyId}",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "policyId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "UpdateRuleBasedPolicyByID": {
        "path": "/{connectionId}/governance/ruleBasedPolicies/{policyId}",
        "method": "PUT",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "policyId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "PatchRuleBasedPolicy": {
        "path": "/{connectionId}/governance/ruleBasedPolicies/{policyId}",
        "method": "PATCH",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "policyId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "ListRuleAssignmentsByPolicyId": {
        "path": "/{connectionId}/governance/ruleBasedPolicies/{policyId}/assignments",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "policyId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "includeRuleSetCounts",
            "in": "query",
            "required": true,
            "type": "boolean"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "CreateEnviornmentGroupRuleBasedAssignment": {
        "path": "/{connectionId}/governance/ruleBasedPolicies/{policyId}/environmentGroups/{groupId}/assignments",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "policyId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "groupId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "201": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "CreateEnvironmentRuleBasedAssignment": {
        "path": "/{connectionId}/governance/ruleBasedPolicies/{policyId}/environments/{environmentId}/assignments",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "policyId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "201": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "RemoveRuleFromRuleBasedPolicy": {
        "path": "/{connectionId}/governance/ruleBasedPolicies/{policyId}/removeRule",
        "method": "PATCH",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "policyId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "ListRuleAssignments": {
        "path": "/{connectionId}/governance/ruleBasedPolicies/assignments",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "includeRuleSetCounts",
            "in": "query",
            "required": true,
            "type": "boolean"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "ListRuleAssignmentsByEnvironmentGroupId": {
        "path": "/{connectionId}/governance/ruleBasedPolicies/environmentGroups/{environmentGroupId}/assignments",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentGroupId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "includeRuleSetCounts",
            "in": "query",
            "required": true,
            "type": "boolean"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "ListRuleAssignmentsByEnvironmentId": {
        "path": "/{connectionId}/governance/ruleBasedPolicies/environments/{environmentId}/assignments",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "includeRuleSetCounts",
            "in": "query",
            "required": true,
            "type": "boolean"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "GetRuleSet": {
        "path": "/{connectionId}/governance/environmentGroups/{groupId}/ruleSets",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "groupId",
            "in": "path",
            "required": true,
            "type": "string",
            "format": "uuid"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "204": {
            "type": "void"
          },
          "400": {
            "type": "object"
          },
          "401": {
            "type": "object"
          },
          "403": {
            "type": "object"
          },
          "500": {
            "type": "object"
          }
        }
      },
      "CreateRuleSet": {
        "path": "/{connectionId}/governance/environmentGroups/{groupId}/ruleSets",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "groupId",
            "in": "path",
            "required": true,
            "type": "string",
            "format": "uuid"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          }
        ],
        "responseInfo": {
          "201": {
            "type": "object"
          },
          "204": {
            "type": "void"
          },
          "400": {
            "type": "object"
          },
          "401": {
            "type": "object"
          },
          "403": {
            "type": "object"
          },
          "500": {
            "type": "object"
          }
        }
      },
      "GetRuleSetListForTenant": {
        "path": "/{connectionId}/governance/ruleSets",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "$select",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "$filter",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "$expand",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "$skiptoken",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "$top",
            "in": "query",
            "required": false,
            "type": "integer"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "object"
          },
          "401": {
            "type": "object"
          },
          "403": {
            "type": "object"
          },
          "500": {
            "type": "object"
          }
        }
      },
      "UpdateRuleSet": {
        "path": "/{connectionId}/governance/ruleSets/{ruleSetId}",
        "method": "PUT",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "ruleSetId",
            "in": "path",
            "required": true,
            "type": "string",
            "format": "uuid"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "object"
          },
          "401": {
            "type": "object"
          },
          "403": {
            "type": "object"
          },
          "500": {
            "type": "object"
          }
        }
      },
      "DeleteRuleSet": {
        "path": "/{connectionId}/governance/ruleSets/{ruleSetId}",
        "method": "DELETE",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "ruleSetId",
            "in": "path",
            "required": true,
            "type": "string",
            "format": "uuid"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          },
          "400": {
            "type": "object"
          },
          "401": {
            "type": "object"
          },
          "403": {
            "type": "object"
          },
          "500": {
            "type": "object"
          }
        }
      },
      "ListCrossTenantConnectionReports": {
        "path": "/{connectionId}/governance/crossTenantConnectionReports",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          }
        }
      },
      "CreateCrossTenantConnectionReport": {
        "path": "/{connectionId}/governance/crossTenantConnectionReports",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "202": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "404": {
            "type": "void"
          }
        }
      },
      "GetCrossTenantConnectionReport": {
        "path": "/{connectionId}/governance/crossTenantConnectionReports/{reportId}",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "reportId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "404": {
            "type": "void"
          }
        }
      },
      "ListBillingPolicies": {
        "path": "/{connectionId}/licensing/billingPolicies",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "$top",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          }
        }
      },
      "CreateBillingPolicy": {
        "path": "/{connectionId}/licensing/billingPolicies",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": false,
            "type": "object"
          }
        ],
        "responseInfo": {
          "201": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          }
        }
      },
      "GetBillingPolicy": {
        "path": "/{connectionId}/licensing/billingPolicies/{billingPolicyId}",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "billingPolicyId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "404": {
            "type": "void"
          }
        }
      },
      "UpdateBillingPolicy": {
        "path": "/{connectionId}/licensing/billingPolicies/{billingPolicyId}",
        "method": "PUT",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "billingPolicyId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": false,
            "type": "object"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "404": {
            "type": "void"
          }
        }
      },
      "DeleteBillingPolicy": {
        "path": "/{connectionId}/licensing/billingPolicies/{billingPolicyId}",
        "method": "DELETE",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "billingPolicyId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "204": {
            "type": "void"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "404": {
            "type": "void"
          }
        }
      },
      "ListBillingPolicyEnvironments": {
        "path": "/{connectionId}/licensing/billingPolicies/{billingPolicyId}/environments",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "billingPolicyId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "404": {
            "type": "void"
          }
        }
      },
      "GetBillingPolicyEnvironment": {
        "path": "/{connectionId}/licensing/billingPolicies/{billingPolicyId}/environments/{environmentId}",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "billingPolicyId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "404": {
            "type": "void"
          }
        }
      },
      "AddBillingPolicyEnvironment": {
        "path": "/{connectionId}/licensing/billingPolicies/{billingPolicyId}/environments/add",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "billingPolicyId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": false,
            "type": "object"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "404": {
            "type": "void"
          }
        }
      },
      "RemoveBillingPolicyEnvironment": {
        "path": "/{connectionId}/licensing/billingPolicies/{billingPolicyId}/environments/remove",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "billingPolicyId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": false,
            "type": "object"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "404": {
            "type": "void"
          }
        }
      },
      "RefreshProvisioningStatus": {
        "path": "/{connectionId}/licensing/billingPolicies/{billingPolicyId}/refreshProvisioningStatus",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "billingPolicyId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "404": {
            "type": "void"
          }
        }
      },
      "GetCurrencyAllocationByEnvironment": {
        "path": "/{connectionId}/licensing/environments/{environmentId}/allocations",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "404": {
            "type": "void"
          }
        }
      },
      "PatchCurrencyAllocationByEnvironment": {
        "path": "/{connectionId}/licensing/environments/{environmentId}/allocations",
        "method": "PATCH",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": false,
            "type": "object"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "404": {
            "type": "void"
          }
        }
      },
      "GetEnvironmentBillingPolicy": {
        "path": "/{connectionId}/licensing/environments/{environmentId}/billingPolicy",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          }
        }
      },
      "ListISVContracts": {
        "path": "/{connectionId}/licensing/isvContracts",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "$top",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          }
        }
      },
      "CreateISVContract": {
        "path": "/{connectionId}/licensing/isvContracts",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": false,
            "type": "object"
          }
        ],
        "responseInfo": {
          "201": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          }
        }
      },
      "GetISVContract": {
        "path": "/{connectionId}/licensing/isvContracts/{isvContractId}",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "isvContractId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "404": {
            "type": "void"
          }
        }
      },
      "UpdateISVContract": {
        "path": "/{connectionId}/licensing/isvContracts/{isvContractId}",
        "method": "PUT",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "isvContractId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": false,
            "type": "object"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "404": {
            "type": "void"
          }
        }
      },
      "DeleteISVContract": {
        "path": "/{connectionId}/licensing/isvContracts/{isvContractId}",
        "method": "DELETE",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "isvContractId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "204": {
            "type": "void"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "404": {
            "type": "void"
          }
        }
      },
      "GetStorageWarningByCategory": {
        "path": "/{connectionId}/licensing/storageWarning/{storageCategory}",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "storageCategory",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "array"
          },
          "404": {
            "type": "object"
          }
        }
      },
      "GetStorageWarningByCategoryAndEntity": {
        "path": "/{connectionId}/licensing/storageWarning/{storageCategory}/{entityName}",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "storageCategory",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "entityName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "array"
          },
          "404": {
            "type": "object"
          }
        }
      },
      "ListStorageWarnings": {
        "path": "/{connectionId}/licensing/storageWarning/getAllStorageWarnings",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "array"
          },
          "404": {
            "type": "object"
          }
        }
      },
      "RetrieveTemporaryCurrencyEntitlementCount": {
        "path": "/{connectionId}/licensing/TemporaryCurrencyEntitlement/{currencyType}/Count",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "currencyType",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "array"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "GetTenantCapacityDetails": {
        "path": "/{connectionId}/licensing/tenantCapacity",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "404": {
            "type": "void"
          }
        }
      },
      "ListCurrencyReports": {
        "path": "/{connectionId}/licensing/tenantCapacity/currencyReports",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "includeAllocations",
            "in": "query",
            "required": false,
            "type": "boolean"
          },
          {
            "name": "includeConsumptions",
            "in": "query",
            "required": false,
            "type": "boolean"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "array"
          }
        }
      },
      "GetUserPerFlowCapacitySource": {
        "path": "/{connectionId}/licensing/UserPerFlowCapacitySource",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "startDate",
            "in": "query",
            "required": true,
            "type": "string",
            "format": "date-time"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "endDate",
            "in": "query",
            "required": false,
            "type": "string",
            "format": "date-time"
          },
          {
            "name": "pageNumber",
            "in": "query",
            "required": false,
            "type": "integer",
            "format": "int32"
          },
          {
            "name": "pageSize",
            "in": "query",
            "required": false,
            "type": "integer",
            "format": "int32"
          },
          {
            "name": "userId",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "flowContext",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "flowLicenseCategorization",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "resourceId",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "query",
            "required": false,
            "type": "string",
            "format": "uuid"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "204": {
            "type": "void"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "GetUserPerFlowCapacitySourceFlowContextSummary": {
        "path": "/{connectionId}/licensing/UserPerFlowCapacitySource/FlowContextSummary",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "startDate",
            "in": "query",
            "required": true,
            "type": "string",
            "format": "date-time"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "endDate",
            "in": "query",
            "required": false,
            "type": "string",
            "format": "date-time"
          },
          {
            "name": "pageNumber",
            "in": "query",
            "required": false,
            "type": "integer",
            "format": "int32"
          },
          {
            "name": "pageSize",
            "in": "query",
            "required": false,
            "type": "integer",
            "format": "int32"
          },
          {
            "name": "environmentId",
            "in": "query",
            "required": false,
            "type": "string",
            "format": "uuid"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "204": {
            "type": "void"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "GetUserPerFlowCapacitySourceFlowContextSummaryForUserId": {
        "path": "/{connectionId}/licensing/UserPerFlowCapacitySource/FlowContextSummary/{userId}",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "userId",
            "in": "path",
            "required": true,
            "type": "string",
            "format": "uuid"
          },
          {
            "name": "startDate",
            "in": "query",
            "required": true,
            "type": "string",
            "format": "date-time"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "endDate",
            "in": "query",
            "required": false,
            "type": "string",
            "format": "date-time"
          },
          {
            "name": "pageNumber",
            "in": "query",
            "required": false,
            "type": "integer",
            "format": "int32"
          },
          {
            "name": "pageSize",
            "in": "query",
            "required": false,
            "type": "integer",
            "format": "int32"
          },
          {
            "name": "environmentId",
            "in": "query",
            "required": false,
            "type": "string",
            "format": "uuid"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "204": {
            "type": "void"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "GetUserPerFlowCapacitySourceTenantContextSummary": {
        "path": "/{connectionId}/licensing/UserPerFlowCapacitySource/TenantContextSummary",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "startDate",
            "in": "query",
            "required": true,
            "type": "string",
            "format": "date-time"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "endDate",
            "in": "query",
            "required": false,
            "type": "string",
            "format": "date-time"
          },
          {
            "name": "environmentId",
            "in": "query",
            "required": false,
            "type": "string",
            "format": "uuid"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "array"
          },
          "204": {
            "type": "void"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "GetUserPerFlowCapacitySourceUserContextSummary": {
        "path": "/{connectionId}/licensing/UserPerFlowCapacitySource/UserContextSummary",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "startDate",
            "in": "query",
            "required": true,
            "type": "string",
            "format": "date-time"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "endDate",
            "in": "query",
            "required": false,
            "type": "string",
            "format": "date-time"
          },
          {
            "name": "pageNumber",
            "in": "query",
            "required": false,
            "type": "integer",
            "format": "int32"
          },
          {
            "name": "pageSize",
            "in": "query",
            "required": false,
            "type": "integer",
            "format": "int32"
          },
          {
            "name": "environmentId",
            "in": "query",
            "required": false,
            "type": "string",
            "format": "uuid"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "204": {
            "type": "void"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "GetUserPerFlowCapacitySourceUserContextSummaryForUserId": {
        "path": "/{connectionId}/licensing/UserPerFlowCapacitySource/UserContextSummary/{userId}",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "userId",
            "in": "path",
            "required": true,
            "type": "string",
            "format": "uuid"
          },
          {
            "name": "startDate",
            "in": "query",
            "required": true,
            "type": "string",
            "format": "date-time"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "endDate",
            "in": "query",
            "required": false,
            "type": "string",
            "format": "date-time"
          },
          {
            "name": "pageNumber",
            "in": "query",
            "required": false,
            "type": "integer",
            "format": "int32"
          },
          {
            "name": "pageSize",
            "in": "query",
            "required": false,
            "type": "integer",
            "format": "int32"
          },
          {
            "name": "environmentId",
            "in": "query",
            "required": false,
            "type": "string",
            "format": "uuid"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "204": {
            "type": "void"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "Get-AdminApps": {
        "path": "/{connectionId}/powerapps/environments/{environmentId}/apps",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "$top",
            "in": "query",
            "required": false,
            "type": "integer"
          },
          {
            "name": "$skiptoken",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "default": {
            "type": "void"
          }
        }
      },
      "Get-AdminApp": {
        "path": "/{connectionId}/powerapps/environments/{environmentId}/apps/{app}",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "app",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "ListCloudFlows": {
        "path": "/{connectionId}/powerautomate/environments/{environmentId}/cloudFlows",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "workflowId",
            "in": "query",
            "required": false,
            "type": "string",
            "format": "uuid"
          },
          {
            "name": "resourceId",
            "in": "query",
            "required": false,
            "type": "string",
            "format": "uuid"
          },
          {
            "name": "createdBy",
            "in": "query",
            "required": false,
            "type": "string",
            "format": "uuid"
          },
          {
            "name": "ownerId",
            "in": "query",
            "required": false,
            "type": "string",
            "format": "uuid"
          },
          {
            "name": "createdOnStartDate",
            "in": "query",
            "required": false,
            "type": "string",
            "format": "date"
          },
          {
            "name": "createdOnEndDate",
            "in": "query",
            "required": false,
            "type": "string",
            "format": "date"
          },
          {
            "name": "modifiedOnStartDate",
            "in": "query",
            "required": false,
            "type": "string",
            "format": "date"
          },
          {
            "name": "modifiedOnEndDate",
            "in": "query",
            "required": false,
            "type": "string",
            "format": "date"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "204": {
            "type": "void"
          },
          "400": {
            "type": "object"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "404": {
            "type": "object"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "ListFlowActions": {
        "path": "/{connectionId}/powerautomate/environments/{environmentId}/flowActions",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "workflowId",
            "in": "query",
            "required": false,
            "type": "string",
            "format": "uuid"
          },
          {
            "name": "parentProcessStageId",
            "in": "query",
            "required": false,
            "type": "string",
            "format": "uuid"
          },
          {
            "name": "connector",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "isTrigger",
            "in": "query",
            "required": false,
            "type": "boolean"
          },
          {
            "name": "parameterName",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "parameterValue",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "exact",
            "in": "query",
            "required": false,
            "type": "boolean"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "204": {
            "type": "void"
          },
          "400": {
            "type": "object"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "404": {
            "type": "object"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "ListFlowRuns": {
        "path": "/{connectionId}/powerautomate/environments/{environmentId}/flowRuns",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "workflowId",
            "in": "query",
            "required": true,
            "type": "string",
            "format": "uuid"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "204": {
            "type": "void"
          },
          "400": {
            "type": "object"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "404": {
            "type": "object"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "GetWebsites": {
        "path": "/{connectionId}/powerpages/environments/{environmentId}/websites",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "skip",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "object"
          },
          "401": {
            "type": "object"
          }
        }
      },
      "CreateWebsite": {
        "path": "/{connectionId}/powerpages/environments/{environmentId}/websites",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          }
        ],
        "responseInfo": {
          "202": {
            "type": "void"
          },
          "400": {
            "type": "object"
          },
          "401": {
            "type": "object"
          },
          "404": {
            "type": "object"
          }
        }
      },
      "GetWebsiteById": {
        "path": "/{connectionId}/powerpages/environments/{environmentId}/websites/{id}",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "id",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "object"
          },
          "401": {
            "type": "object"
          },
          "404": {
            "type": "object"
          }
        }
      },
      "DeleteWebsite": {
        "path": "/{connectionId}/powerpages/environments/{environmentId}/websites/{id}",
        "method": "DELETE",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "Operation-Location",
            "in": "header",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "id",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "202": {
            "type": "void"
          },
          "400": {
            "type": "object"
          },
          "401": {
            "type": "object"
          },
          "404": {
            "type": "object"
          }
        }
      },
      "ConvertTrialToProduction": {
        "path": "/{connectionId}/powerpages/environments/{environmentId}/websites/{id}/convertToProduction",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "id",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          }
        ],
        "responseInfo": {
          "202": {
            "type": "void"
          },
          "400": {
            "type": "object"
          },
          "401": {
            "type": "object"
          },
          "404": {
            "type": "object"
          }
        }
      },
      "CreateWafRules": {
        "path": "/{connectionId}/powerpages/environments/{environmentId}/websites/{id}/createWafRules",
        "method": "PUT",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "id",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          }
        ],
        "responseInfo": {
          "202": {
            "type": "void"
          },
          "400": {
            "type": "object"
          },
          "401": {
            "type": "object"
          },
          "404": {
            "type": "object"
          }
        }
      },
      "DeleteWafCustomRules": {
        "path": "/{connectionId}/powerpages/environments/{environmentId}/websites/{id}/deleteWafCustomRules",
        "method": "PUT",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "id",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          }
        ],
        "responseInfo": {
          "202": {
            "type": "void"
          },
          "400": {
            "type": "object"
          },
          "401": {
            "type": "object"
          },
          "404": {
            "type": "object"
          }
        }
      },
      "DisableWaf": {
        "path": "/{connectionId}/powerpages/environments/{environmentId}/websites/{id}/disableWaf",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "id",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "string"
          },
          "400": {
            "type": "object"
          },
          "401": {
            "type": "object"
          },
          "404": {
            "type": "object"
          }
        }
      },
      "EnableWAF": {
        "path": "/{connectionId}/powerpages/environments/{environmentId}/websites/{id}/enableWaf",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "id",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "202": {
            "type": "void"
          },
          "400": {
            "type": "object"
          },
          "401": {
            "type": "object"
          },
          "404": {
            "type": "object"
          },
          "409": {
            "type": "object"
          }
        }
      },
      "GetWAFRules": {
        "path": "/{connectionId}/powerpages/environments/{environmentId}/websites/{id}/getWafRules",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "id",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "ruleType",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "object"
          },
          "401": {
            "type": "object"
          },
          "404": {
            "type": "object"
          }
        }
      },
      "GetWAFStatus": {
        "path": "/{connectionId}/powerpages/environments/{environmentId}/websites/{id}/getWafStatus",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "id",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "string"
          },
          "400": {
            "type": "object"
          },
          "401": {
            "type": "object"
          },
          "404": {
            "type": "object"
          }
        }
      },
      "AddAllowedIpAddresses": {
        "path": "/{connectionId}/powerpages/environments/{environmentId}/websites/{id}/ipaddressrules",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "id",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "array"
          },
          "400": {
            "type": "object"
          },
          "401": {
            "type": "object"
          },
          "404": {
            "type": "object"
          }
        }
      },
      "RemoveAllowedIpAddresses": {
        "path": "/{connectionId}/powerpages/environments/{environmentId}/websites/{id}/removeAllowedIpAddresses",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "id",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "array"
          },
          "400": {
            "type": "object"
          },
          "401": {
            "type": "object"
          },
          "404": {
            "type": "object"
          }
        }
      },
      "RestartWebsite": {
        "path": "/{connectionId}/powerpages/environments/{environmentId}/websites/{id}/restart",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "id",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          },
          "400": {
            "type": "object"
          },
          "401": {
            "type": "object"
          },
          "404": {
            "type": "object"
          }
        }
      },
      "GetSecurityScanReport": {
        "path": "/{connectionId}/powerpages/environments/{environmentId}/websites/{id}/scan/deep/getLatestCompletedReport",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "id",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "object"
          },
          "401": {
            "type": "object"
          },
          "404": {
            "type": "object"
          }
        }
      },
      "GetSecurityScanScore": {
        "path": "/{connectionId}/powerpages/environments/{environmentId}/websites/{id}/scan/deep/getSecurityScore",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "id",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "object"
          },
          "401": {
            "type": "object"
          },
          "404": {
            "type": "object"
          }
        }
      },
      "StartDeepScan": {
        "path": "/{connectionId}/powerpages/environments/{environmentId}/websites/{id}/scan/deep/start",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "id",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "202": {
            "type": "void"
          },
          "400": {
            "type": "object"
          },
          "401": {
            "type": "object"
          },
          "404": {
            "type": "object"
          }
        }
      },
      "StartQuickScan": {
        "path": "/{connectionId}/powerpages/environments/{environmentId}/websites/{id}/scan/quick/execute",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "id",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "lcid",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "array"
          },
          "400": {
            "type": "object"
          },
          "401": {
            "type": "object"
          },
          "404": {
            "type": "object"
          }
        }
      },
      "SetPortalBootstrapV5Enabled": {
        "path": "/{connectionId}/powerpages/environments/{environmentId}/websites/{id}/SetPortalBootstrapV5Enabled",
        "method": "PATCH",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "id",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          },
          "400": {
            "type": "object"
          },
          "401": {
            "type": "object"
          },
          "404": {
            "type": "object"
          }
        }
      },
      "SetPortalDataModelVersion": {
        "path": "/{connectionId}/powerpages/environments/{environmentId}/websites/{id}/setPortalDataModelVersion",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "id",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          },
          "400": {
            "type": "object"
          },
          "401": {
            "type": "object"
          },
          "404": {
            "type": "object"
          }
        }
      },
      "StartWebsite": {
        "path": "/{connectionId}/powerpages/environments/{environmentId}/websites/{id}/start",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "id",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          },
          "400": {
            "type": "object"
          },
          "401": {
            "type": "object"
          },
          "404": {
            "type": "object"
          }
        }
      },
      "StopWebsite": {
        "path": "/{connectionId}/powerpages/environments/{environmentId}/websites/{id}/stop",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "id",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          },
          "400": {
            "type": "object"
          },
          "401": {
            "type": "object"
          },
          "404": {
            "type": "object"
          }
        }
      },
      "ToggleAFDTrafficRouting": {
        "path": "/{connectionId}/powerpages/environments/{environmentId}/websites/{id}/toggleAFDTrafficRouting",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "id",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "enableAFD",
            "in": "query",
            "required": true,
            "type": "boolean"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "object"
          },
          "401": {
            "type": "object"
          },
          "404": {
            "type": "object"
          }
        }
      },
      "UpdatePortalSecurityGroup": {
        "path": "/{connectionId}/powerpages/environments/{environmentId}/websites/{id}/updatePortalSecurityGroup",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "id",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "securityGroupId",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          },
          "400": {
            "type": "object"
          },
          "401": {
            "type": "object"
          },
          "404": {
            "type": "object"
          }
        }
      },
      "UpdateSiteVisibility": {
        "path": "/{connectionId}/powerpages/environments/{environmentId}/websites/{id}/updateSiteVisibility",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "id",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "siteVisibility",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          },
          "400": {
            "type": "object"
          },
          "401": {
            "type": "object"
          },
          "404": {
            "type": "object"
          }
        }
      },
      "QueryResources": {
        "path": "/{connectionId}/resourcequery/resources/query",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "429": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "ApplyAdminRole": {
        "path": "/{connectionId}/usermanagement/environments/{environmentId}/user/applyAdminRole",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          }
        }
      },
      "GetFlowRunActionsForDsr": {
        "path": "/{connectionId}/workflowsagent/aiFlows/{aiFlowId}/runs/{runId}/actions",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "aiFlowId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "runId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "continuationToken",
            "in": "query",
            "required": false,
            "type": "integer",
            "format": "int64"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "GetApprovals": {
        "path": "/{connectionId}/workflowsagent/approvals",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "continuationToken",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "DeleteApproval": {
        "path": "/{connectionId}/workflowsagent/approvals/{approvalId}",
        "method": "DELETE",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "approvalId",
            "in": "path",
            "required": true,
            "type": "string",
            "format": "uuid"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "204": {
            "type": "void"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "GetConnections": {
        "path": "/{connectionId}/workflowsagent/connections",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "continuationToken",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "DeleteConnection": {
        "path": "/{connectionId}/workflowsagent/connections/{connectionIdentifier}",
        "method": "DELETE",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "connectionIdentifier",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "204": {
            "type": "void"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "GetConversationTranscriptsForDsr": {
        "path": "/{connectionId}/workflowsagent/conversationTranscripts",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "continuationToken",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "GetFlowRunActionsWithEnvironment": {
        "path": "/{connectionId}/workflowsagent/environments/{environmentId}/aiFlows/{aiFlowId}/runs/{runId}/actions",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "aiFlowId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "runId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "continuationToken",
            "in": "query",
            "required": false,
            "type": "integer",
            "format": "int64"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "GetConversationTranscriptsWithEnvironment": {
        "path": "/{connectionId}/workflowsagent/environments/{environmentId}/conversationTranscripts",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "continuationToken",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "401": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "GetFlowRunsNonSingleton": {
        "path": "/{connectionId}/workflowsagent/environments/{environmentId}/flows/{flowId}/flowRuns",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "flowId",
            "in": "path",
            "required": true,
            "type": "string",
            "format": "uuid"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "continuationToken",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "GetRunHistoryDataNonSingleton": {
        "path": "/{connectionId}/workflowsagent/environments/{environmentId}/flows/{flowId}/runs/{runId}/runHistoryData",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "flowId",
            "in": "path",
            "required": true,
            "type": "string",
            "format": "uuid"
          },
          {
            "name": "runId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "continuationToken",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "GetFlows": {
        "path": "/{connectionId}/workflowsagent/flows",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "continuationToken",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "DeleteFlow": {
        "path": "/{connectionId}/workflowsagent/flows/{flowId}",
        "method": "DELETE",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "flowId",
            "in": "path",
            "required": true,
            "type": "string",
            "format": "uuid"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "204": {
            "type": "void"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "GetFlowRunsSingleton": {
        "path": "/{connectionId}/workflowsagent/flows/{flowId}/flowRuns",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "flowId",
            "in": "path",
            "required": true,
            "type": "string",
            "format": "uuid"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "continuationToken",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "GetRunHistoryData": {
        "path": "/{connectionId}/workflowsagent/flows/{flowId}/runs/{runId}/runHistoryData",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "flowId",
            "in": "path",
            "required": true,
            "type": "string",
            "format": "uuid"
          },
          {
            "name": "runId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "continuationToken",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "GetPrompts": {
        "path": "/{connectionId}/workflowsagent/prompts",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "continuationToken",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "DeletePrompt": {
        "path": "/{connectionId}/workflowsagent/prompts/{promptId}",
        "method": "DELETE",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "promptId",
            "in": "path",
            "required": true,
            "type": "string",
            "format": "uuid"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "204": {
            "type": "void"
          },
          "400": {
            "type": "void"
          },
          "401": {
            "type": "void"
          },
          "404": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "mcp_EnvironmentManagement": {
        "path": "/{connectionId}/mcp/EnvironmentManagement",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "queryRequest",
            "in": "body",
            "required": false,
            "type": "object"
          },
          {
            "name": "sessionId",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "default": {
            "type": "void"
          }
        }
      },
      "mcp_Governance": {
        "path": "/{connectionId}/mcp/Governance",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "queryRequest",
            "in": "body",
            "required": false,
            "type": "object"
          },
          {
            "name": "sessionId",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "default": {
            "type": "void"
          }
        }
      }
    }
  },
  "powerplatformforadmins": {
    "tableId": "",
    "version": "",
    "primaryKey": "",
    "dataSourceType": "Connector",
    "apis": {
      "Get-AdminEnvironment": {
        "path": "/{connectionId}/environments",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "$skiptoken",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "$top",
            "in": "query",
            "required": false,
            "type": "integer"
          },
          {
            "name": "$expand",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "NewAdminEnvironment": {
        "path": "/{connectionId}/environments",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "id",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          }
        ],
        "responseInfo": {
          "201": {
            "type": "object"
          },
          "403": {
            "type": "object"
          },
          "409": {
            "type": "object"
          }
        }
      },
      "GetSingleEnvironment": {
        "path": "/{connectionId}/environments/{environment}",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environment",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "Remove-AdminEnvironment": {
        "path": "/{connectionId}/environments/{environment}",
        "method": "DELETE",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environment",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "202": {
            "type": "object"
          },
          "204": {
            "type": "object"
          }
        }
      },
      "Get-AdminEnvironmentRoleAssignment": {
        "path": "/{connectionId}/environments/{environment}/roleAssignments",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environment",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "Edit-AdminEnvironmentRoleAssignment": {
        "path": "/{connectionId}/environments/{environment}/modifyRoleAssignments",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environment",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": false,
            "type": "object"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "Get-AdminDlpPolicies": {
        "path": "/{connectionId}/apiPolicies",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "NewTenantPolicy": {
        "path": "/{connectionId}/apiPolicies",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": false,
            "type": "object"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "Edit-AdminDlpPolicy": {
        "path": "/{connectionId}/apiPolicies/{policy}",
        "method": "PUT",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "policy",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": false,
            "type": "object"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "GetTenantPolicy": {
        "path": "/{connectionId}/apiPolicies/{policy}",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "policy",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "RemoveTenantPolicy": {
        "path": "/{connectionId}/apiPolicies/{policy}",
        "method": "DELETE",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "policy",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "ListSupportedLocations": {
        "path": "/{connectionId}/locations",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "ListEnvironmentLanguages": {
        "path": "/{connectionId}/locations/{environmentLocation}/environmentLanguages",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentLocation",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "ListEnvironmentCurrencies": {
        "path": "/{connectionId}/locations/{environmentLocation}/environmentCurrencies",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environmentLocation",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "ProvisionInstance": {
        "path": "/{connectionId}/environments/{environment}/provisionInstance",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": true,
            "type": "string"
          },
          {
            "name": "environment",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": false,
            "type": "object"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          },
          "202": {
            "type": "object"
          }
        }
      },
      "GetProvisionOperation": {
        "path": "/{connectionId}/environments/{environment}/provisionOperations/{operationName}",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environment",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "operationName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          },
          "202": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "GetProvisionOperationV2": {
        "path": "/{connectionId}/providers/Microsoft.BusinessAppPlatform/environments/{environment}/provisionOperations/{operationName}",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environment",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "operationName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          },
          "202": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "GetEnvironmentOperation": {
        "path": "/{connectionId}/scopes/admin/environments/{environment}/operations/{operationName}",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environment",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "operationName",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          },
          "202": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "Add-AdminPowerAppsSyncUser": {
        "path": "/{connectionId}/environments/{environment}/addUser",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environment",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          },
          "403": {
            "type": "void"
          },
          "500": {
            "type": "void"
          }
        }
      },
      "ValidateDelete": {
        "path": "/{connectionId}/environments/{environment}/validateDelete",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environment",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "NewEnvironmentPolicy": {
        "path": "/{connectionId}/environments/{environment}/apiPolicies",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environment",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "GetEnvironmentPolicy": {
        "path": "/{connectionId}/environments/{environment}/apiPolicies/{policy}",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environment",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "policy",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "EditEnvironmentPolicy": {
        "path": "/{connectionId}/environments/{environment}/apiPolicies/{policy}",
        "method": "PUT",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environment",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "policy",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "RemoveEnvironmentPolicy": {
        "path": "/{connectionId}/environments/{environment}/apiPolicies/{policy}",
        "method": "DELETE",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environment",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "policy",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "ListPoliciesV2": {
        "path": "/{connectionId}/providers/PowerPlatform.Governance/v1/policies",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "$skiptoken",
            "in": "query",
            "required": false,
            "type": "string"
          },
          {
            "name": "$top",
            "in": "query",
            "required": false,
            "type": "integer"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "CreatePolicyV2": {
        "path": "/{connectionId}/providers/PowerPlatform.Governance/v1/policies",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": false,
            "type": "object"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "GetPolicyV2": {
        "path": "/{connectionId}/providers/PowerPlatform.Governance/v1/policies/{policy}",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "policy",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "UpdatePolicyV2": {
        "path": "/{connectionId}/providers/PowerPlatform.Governance/v1/policies/{policy}",
        "method": "PATCH",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "policy",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "DeletePolicyV2": {
        "path": "/{connectionId}/providers/PowerPlatform.Governance/v1/policies/{policy}",
        "method": "DELETE",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "policy",
            "in": "path",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "object"
          }
        }
      },
      "UpdateEnvironment": {
        "path": "/{connectionId}/providers/Microsoft.BusinessAppPlatform/environments/{environment}",
        "method": "PATCH",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "environment",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "body",
            "in": "body",
            "required": true,
            "type": "object"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          }
        }
      },
      "GetLifecycleOperationStatus": {
        "path": "/{connectionId}/providers/Microsoft.BusinessAppPlatform/lifecycleOperations/{lifecycleOperationId}",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "lifecycleOperationId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "api-version",
            "in": "query",
            "required": false,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "void"
          },
          "202": {
            "type": "void"
          }
        }
      },
      "ListUnblockableConnectors": {
        "path": "/{connectionId}/providers/PowerPlatform.Governance/v1/connectors/metadata/unblockable",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "array"
          }
        }
      },
      "ListVirtualConnectors": {
        "path": "/{connectionId}/providers/PowerPlatform.Governance/v1/connectors/metadata/virtual",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "array"
          }
        }
      }
    }
  },
  "webcontents": {
    "tableId": "",
    "version": "",
    "primaryKey": "",
    "dataSourceType": "Connector",
    "apis": {
      "GetFileContent": {
        "path": "/{connectionId}/GetFileContent",
        "method": "GET",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "path",
            "in": "query",
            "required": true,
            "type": "string"
          }
        ],
        "responseInfo": {
          "200": {
            "type": "string",
            "format": "binary"
          },
          "default": {
            "type": "object"
          }
        }
      },
      "InvokeHttp": {
        "path": "/{connectionId}/codeless/InvokeHttp",
        "method": "POST",
        "parameters": [
          {
            "name": "connectionId",
            "in": "path",
            "required": true,
            "type": "string"
          },
          {
            "name": "request",
            "in": "body",
            "required": true,
            "type": "object"
          }
        ],
        "responseInfo": {
          "default": {
            "type": "object"
          }
        }
      }
    }
  }
};
