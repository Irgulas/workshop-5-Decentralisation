import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";// Importation de la configuration du port de base
import { NodeState, Value } from "../types";// Types personnalisés pour l'état du noeud et la valeur
import { delay } from "../utils";// Fonction utilitaire pour introduire un délai

// Fonction principale asynchrone pour initialiser un noeud dans le réseau
export async function node(
    nodeId: number, // Identifiant unique du noeud
    N: number, // Nombre total de noeuds dans le réseau
    F: number, // Nombre de noeuds défaillants dans le réseau
    initialValue: Value, // Valeur initiale du noeud
    isFaulty: boolean, // Indique si le noeud est défaillant
    nodesAreReady: () => boolean, // Fonction pour vérifier si tous les noeuds sont prêts
    setNodeIsReady: (index: number) => void // Fonction pour indiquer qu'un noeud est prêt
) {
  const node = express(); // Initialisation de l'application express
  node.use(express.json()); // Middleware pour parser les JSON dans les requêtes entrantes
  node.use(bodyParser.json()); // Middleware bodyParser pour analyser le corps des requêtes JSON

  // Initialisation de l'état du noeud avec des valeurs par défaut
  let mynode: NodeState = {
    killed: false,
    x: null,
    decided: null,
    k: null,
  }
  //Maps pour stocker les propositions et les votes des autres noeuds
  let proposals: Map<number, Value[]> = new Map();
  let votes: Map<number, Value[]> = new Map();


  // Endpoint pour récupérer le statut actuel du noeud
  node.get("/status", (req, res) => {
    if (isFaulty) {


// Si le noeud est défaillant, réinitialiser son état et répondre avec une erreur
      mynode.x = null;
      mynode.decided = null;
      mynode.k = null;
      res.status(500).send("faulty");
    } else {
      // Si le noeud fonctionne normalement, répondre avec un statut positif
      res.status(200).send("live");
    }
  });


  // TODO implement this
  // this route allows the node to receive messages from other nodes
  // node.post("/message", (req, res) => {});
  // Endpoint pour recevoir les messages des autres noeuds et traiter les propositions et votes
  node.post("/message", async function(req, res) {
    // Récupération des données du message
    let { k, x, messageType } = req.body;

    // Vérification si le nœud est défectueux ou arrêté
    if (!isFaulty && !mynode.killed) {
      // Traitement des messages uniquement si le noeud n'est ni défaillant ni arrêté
      if (messageType == "propose") {
        // Initialisation de la structure de données pour stocker les propositions
        if (!proposals.has(k)) {
          proposals.set(k, []);
        }
        proposals.get(k)!.push(x); // Stockage de la proposition
        let proposal = proposals.get(k);
        proposal=proposal!;
        // Si le nombre de propositions reçues dépasse le seuil de tolérance
        if (proposal.length >= (N - F)) {
          // Comptage et comparaison des votes pour déterminer la valeur de consensus
          let count0 = proposal.filter(function(el) { return el == 0; }).length;
          let count1 = proposal.filter(function(el) { return el == 1; }).length;

          // Détermination de la valeur de consensus
          if (count0 > (N / 2)) {
            x = 0;
          } else if (count1 > (N / 2)) {
            x = 1;
          } else {
            x = "?";
          }

          // Envoyer un message de vote à tous les autres nœuds
          for (let i = 0; i < N; i++) {
            fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ k: k, x: x, messageType: "vote" }),
            });
          }
        }
      }
      // Si le message est de type "vote"
      else if (messageType == "vote") {
        // Traitement des votes
        if (!votes.has(k)) {
          votes.set(k, []);
        }
        votes.get(k)!.push(x); // Stockage du vote
        let vote = votes.get(k)!;

        // Si le nombre de votes reçus dépasse le seuil de tolérance
        if (vote.length >= (N - F)) {
          console.log("vote", vote, "node :", nodeId, "k :", k);
          // Compter le nombre de votes pour chaque valeur
          let count0 = vote.filter(function(el) { return el == 0; }).length;
          let count1 = vote.filter(function(el) { return el == 1; }).length;

          // Détermination de la valeur de consensus
          if (count0 >= F + 1) {
            mynode.x = 0;
            mynode.decided = true;
          } else if (count1 >= F + 1) {
            mynode.x = 1;
            mynode.decided = true;
          } else {
            if (count0 + count1 > 0 && count0 > count1) {
              mynode.x = 0;
            } else if (count0 + count1 > 0 && count0 < count1) {
              mynode.x = 1;

            } else {
              mynode.x = Math.random() > 0.5 ? 0 : 1;
            }
            mynode.k = k + 1;

            for (let i = 0; i < N; i++) {
              fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({ k: mynode.k, x: mynode.x, messageType: "propose" }),
              });
            }
          }
        }
      }
    }
    // Confirmation de la réception et du traitement du message
    res.status(200).send("Message received and processed.");
  });


// Ce point d'entrée `/start` lance l'algorithme de consensus.
// Il attend d'abord que tous les noeuds soient prêts avant de procéder.
  node.get("/start", async (req, res) => {
    // Boucle d'attente active jusqu'à ce que tous les noeuds soient prêts à démarrer.
    while (!nodesAreReady()) {
      await delay(5); // Attente de 5 millisecondes avant la prochaine vérification
    }

    if (!isFaulty) { // Si ce noeud n'est pas défaillant, il initie le processus de consensus
      mynode.k = 1; // Initialise le compteur de tours pour le consensus
      mynode.x = initialValue; // Définit la valeur initiale du noeud pour le consensus
      mynode.decided = false; // Indique que le noeud n'a pas encore décidé de la valeur finale

      // Envoie une proposition initiale à tous les autres noeuds dans le réseau
      for (let i = 0; i < N; i++) {
        fetch(`http://localhost:${BASE_NODE_PORT + i}/message`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ k: mynode.k, x: mynode.x, messageType: "propose" }),
        });
      }
    } else {
      // Si le noeud est défaillant, réinitialise ses variables d'état
      mynode.decided = null;
      mynode.x = null;
      mynode.k = null;
    }

    // Répond que l'algorithme de consensus a bien été démarré
    res.status(200).send("Consensus algorithm started.");
  });

// Ce point d'entrée permet d'arrêter le noeud en mettant à jour son état comme étant « tué »
  node.get("/stop", (req, res) => {
    mynode.killed = true; // Marque le noeud comme étant arrêté
    res.status(200).send("killed"); // Confirme l'arrêt du noeud
  });

// Ce point d'entrée fournit l'état actuel du noeud, y compris si celui-ci a été arrêté
  node.get("/getState", (req, res) => {
    // Envoie l'état actuel du noeud, incluant sa disponibilité, sa valeur courante, etc.
    res.status(200).send({
      killed: mynode.killed,
      x: mynode.x,
      decided: mynode.decided,
      k: mynode.k,
    });
  });

// Démarre le serveur sur le port spécifié et marque le noeud comme prêt à recevoir des requêtes
  const server = node.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(`Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`);

    // Marque ce noeud comme étant prêt, permettant ainsi aux autres noeuds de savoir qu'ils peuvent communiquer avec lui
    setNodeIsReady(nodeId);
  });

  return server; // Retourne l'instance du serveur pour une éventuelle référence ou gestion ultérieure
}