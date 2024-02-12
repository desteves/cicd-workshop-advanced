import * as pulumi from "@pulumi/pulumi";
import * as pulumiservice from "@pulumi/pulumiservice";
import * as aws from "@pulumi/aws";
import { stringify } from 'yaml'
import createESCEnvironment from './preview-api-esc';

// Configurations
const audience = pulumi.getOrganization();
const config = new pulumi.Config();
const oidcIdpUrl: string = config.require('oidcIdpUrl');
const thumbprint: string = config.require('thumbprint');
export const escEnv: string = config.require('escEnv');

// Create an AWS IAM OIDC Identity Provider.
// TODO - if the OIDC provider already exists, we should use it instead of creating a new one

const oidcProvider = new aws.iam.OpenIdConnectProvider("oidcProvider", {
    clientIdLists: [audience],
    url: oidcIdpUrl, // Replace with your IdP URL
    thumbprintLists: [thumbprint], // Replace with the thumbprint of the IdP server's certificate
});

// Create a new role that can be assumed by the OIDC provider
const role = new aws.iam.Role("oidcProviderRole", {
    assumeRolePolicy: pulumi.all([oidcProvider.url, oidcProvider.arn, audience]).apply(([url, arn, audience]) => JSON.stringify({
        Version: "2012-10-17",
        Statement: [{
            Effect: "Allow",
            Principal: { Federated: arn },
            Action: "sts:AssumeRoleWithWebIdentity",
            Condition: { StringEquals: { [`${url}:aud`]: [audience] } },
        }],
    })),
});

// Create a new Pulumi Cloud access token to be used to create the environment
const accessToken = new pulumiservice.AccessToken("myAccessToken", {
    description: "Used to create an ESC Environment for AWS OIDC",
}, { dependsOn: [role] });

accessToken.value.apply(tokenId => {
    role.arn.apply(arn => {
        const yamlStr = stringify(
            {
                "values": {
                    "aws": {
                        "login": {
                            "fn::open::aws-login": {
                                "oidc": {
                                    "duration": "1h",
                                    "roleArn": `${arn}`,
                                    "sessionName": "pulumi-environments-session"
                                }
                            }
                        }
                    },
                    "environmentVariables": {
                        "AWS_ACCESS_KEY_ID": "${aws.login.accessKeyId}",
                        "AWS_SECRET_ACCESS_KEY": "${aws.login.secretAccessKey}",
                        "AWS_SESSION_TOKEN": "${aws.login.sessionToken}"
                    }
                },
            }
        );
        createESCEnvironment(yamlStr, audience, escEnv, tokenId);
    });
});
